import { prisma } from "../../db/prisma.js";
import {
  applyLedgerTransfer,
  getSystemAccountId,
  getUserAssetAccountId,
  TX_OPTIONS,
  InsufficientBalanceError,
} from "../../ledger/ledger.service.js";

export { InsufficientBalanceError };

interface RequestInput {
  userId: string;
  assetId: string;
  toAddress: string;
  amount: string | number;
}

/**
 * Debiting the user's ledger balance at request time *is* the hold — `applyLedgerTransfer`
 * already refuses to go negative, so two concurrent withdrawal requests can't double-spend
 * the same balance. Rejecting later just credits it back (see rejectWithdrawal). Not a
 * taxable disposal — moving crypto to an address you own isn't in the tax applicability
 * matrix, so no tax module involvement here.
 */
export async function requestWithdrawal(input: RequestInput) {
  const userAccountId = await getUserAssetAccountId(input.userId, input.assetId);
  const externalAccountId = await getSystemAccountId("EXTERNAL", input.assetId);

  return prisma.$transaction(
    async (tx) => {
      const withdrawal = await tx.withdrawal.create({
        data: {
          userId: input.userId,
          assetId: input.assetId,
          toAddress: input.toAddress,
          amount: input.amount,
          status: "PENDING",
        },
      });

      await applyLedgerTransfer(tx, {
        fromAccountId: userAccountId,
        toAccountId: externalAccountId,
        assetId: input.assetId,
        amount: input.amount,
        refType: "WITHDRAWAL",
        refId: withdrawal.id,
      });

      return withdrawal;
    },
    TX_OPTIONS,
  );
}

export async function listWithdrawalsForUser(userId: string) {
  return prisma.withdrawal.findMany({ where: { userId }, orderBy: { requestedAt: "desc" } });
}

export async function listPendingWithdrawals() {
  return prisma.withdrawal.findMany({
    where: { status: { in: ["PENDING", "APPROVED", "SENT"] } },
    orderBy: { requestedAt: "asc" },
    include: { user: { select: { email: true } }, asset: { select: { symbol: true, chain: true, decimals: true } } },
  });
}

/** Admin has manually sent the real crypto from their phone wallet; records the resulting tx hash. */
export async function markWithdrawalSent(withdrawalId: string, txHash: string, adminId: string) {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) throw new Error("Withdrawal not found");
  if (withdrawal.status !== "PENDING" && withdrawal.status !== "APPROVED") {
    throw new Error(`Cannot mark sent from status ${withdrawal.status}`);
  }

  return prisma.withdrawal.update({
    where: { id: withdrawalId },
    data: { status: "SENT", txHash, processedByAdmin: adminId, processedAt: new Date() },
  });
}

export async function confirmWithdrawal(withdrawalId: string) {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) throw new Error("Withdrawal not found");
  if (withdrawal.status !== "SENT") {
    throw new Error(`Cannot confirm from status ${withdrawal.status} — mark it sent first`);
  }
  return prisma.withdrawal.update({ where: { id: withdrawalId }, data: { status: "CONFIRMED" } });
}

/** Refunds the held balance back to the user and closes the request out. */
export async function rejectWithdrawal(withdrawalId: string, adminId: string, notes?: string) {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) throw new Error("Withdrawal not found");

  const userAccountId = await getUserAssetAccountId(withdrawal.userId, withdrawal.assetId);
  const externalAccountId = await getSystemAccountId("EXTERNAL", withdrawal.assetId);

  return prisma.$transaction(async (tx) => {
    const current = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!current) throw new Error("Withdrawal not found");
    if (current.status !== "PENDING" && current.status !== "APPROVED") {
      throw new Error(`Cannot reject from status ${current.status}`);
    }

    await applyLedgerTransfer(tx, {
      fromAccountId: externalAccountId,
      toAccountId: userAccountId,
      assetId: current.assetId,
      amount: current.amount,
      refType: "WITHDRAWAL",
      refId: current.id,
    });

    return tx.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: "REJECTED", processedByAdmin: adminId, processedAt: new Date(), notes },
    });
  }, TX_OPTIONS);
}
