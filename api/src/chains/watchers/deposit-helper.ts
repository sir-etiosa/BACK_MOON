import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { applyLedgerMovement, TX_OPTIONS } from "../../ledger/ledger.service.js";
import { mailer } from "../../modules/auth/mailer.js";

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
  let justCredited = false;

  const deposit = await prisma.$transaction(async (tx) => {
    const existing = await tx.deposit.findUnique({
      where: { txHash_address: { txHash: input.txHash, address: input.address } },
    });

    let d = existing
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

    if (d.status === "CREDITED") return d;
    if (input.confirmations < input.requiredConfirmations) return d;

    await applyLedgerMovement(tx, {
      userId: input.userId,
      assetId: input.assetId,
      direction: "CREDIT",
      amount: input.amount,
      refType: "DEPOSIT",
      refId: d.id,
    });

    d = await tx.deposit.update({
      where: { id: d.id },
      data: { status: "CREDITED", creditedAt: new Date() },
    });
    justCredited = true;
    return d;
  }, TX_OPTIONS);

  // Notify after the transaction commits — email failure must never roll back a real credit,
  // and a rolled-back transaction must never have already sent an email.
  if (justCredited) {
    await notifyDepositCredited(input.userId, input.assetId, input.amount).catch((err) => {
      console.error("deposit notification email failed:", (err as Error).message);
    });
  }

  return deposit;
}

async function notifyDepositCredited(userId: string, assetId: string, amount: string | number) {
  const [user, asset] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.asset.findUniqueOrThrow({ where: { id: assetId } }),
  ]);

  const whole = new Prisma.Decimal(amount).div(new Prisma.Decimal(10).pow(asset.decimals));

  await mailer.send(
    user.email,
    `Deposit received: ${whole.toString()} ${asset.symbol}`,
    `We've credited ${whole.toString()} ${asset.symbol} to your MoonXch balance. It's available to use now.`,
  );
}
