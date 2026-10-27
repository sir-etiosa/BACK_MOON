import { prisma } from "../../db/prisma.js";
import { applyLedgerMovement, TX_OPTIONS } from "../../ledger/ledger.service.js";

interface ObservedDeposit {
  userId: string;
  assetId: string;
  address: string;
  txHash: string;
  amount: string | number;
  confirmations: number;
  requiredConfirmations: number;
}

/**
 * Records one observed on-chain transfer and credits the ledger once it has enough
 * confirmations — safe to call repeatedly for the same tx (every watcher run re-observes
 * recent transfers): the deposit row is locked inside a transaction, and once status is
 * CREDITED this is a no-op forever. The ledger's own unique constraint on
 * (refType, refId, userId, direction) is the final backstop against double-crediting.
 */
export async function recordAndCreditIfReady(input: ObservedDeposit) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.deposit.findUnique({
      where: { txHash_address: { txHash: input.txHash, address: input.address } },
    });

    let deposit = existing
      ? await tx.deposit.update({
          where: { id: existing.id },
          data: { confirmations: input.confirmations },
        })
      : await tx.deposit.create({
          data: {
            userId: input.userId,
            assetId: input.assetId,
            address: input.address,
            txHash: input.txHash,
            amount: input.amount,
            confirmations: input.confirmations,
            status: "PENDING",
          },
        });

    if (deposit.status === "CREDITED") return deposit;
    if (input.confirmations < input.requiredConfirmations) return deposit;

    await applyLedgerMovement(tx, {
      userId: input.userId,
      assetId: input.assetId,
      direction: "CREDIT",
      amount: input.amount,
      refType: "DEPOSIT",
      refId: deposit.id,
    });

    deposit = await tx.deposit.update({
      where: { id: deposit.id },
      data: { status: "CREDITED", creditedAt: new Date() },
    });
    return deposit;
  }, TX_OPTIONS);
}
