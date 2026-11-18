import { prisma } from "../../db/prisma.js";
import { InsufficientBalanceError } from "../../ledger/ledger.service.js";
import { executeTaxedCashout } from "../tax/cashout.service.js";
import { reverseTaxTransaction } from "../tax/reversal.service.js";

export { InsufficientBalanceError };

interface CreateCashoutRequestInput {
  userId: string;
  sourceAssetId: string;
  ngnAmount: string | number;
  bankAccountId: string;
}

export async function createCashoutRequest(input: CreateCashoutRequestInput) {
  return executeTaxedCashout(input);
}

export async function listCashoutRequestsForUser(userId: string) {
  return prisma.cashoutRequest.findMany({ where: { userId }, orderBy: { requestedAt: "desc" } });
}

export async function listPendingCashoutRequests() {
  return prisma.cashoutRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { requestedAt: "asc" },
    include: { user: { select: { email: true } } },
  });
}

export async function markCashoutPaid(requestId: string, adminId: string) {
  const request = await prisma.cashoutRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new Error("Cash-out request not found");
  if (request.status !== "PENDING") throw new Error(`Cannot mark paid from status ${request.status}`);

  return prisma.cashoutRequest.update({
    where: { id: requestId },
    data: { status: "PAID", processedByAdmin: adminId, processedAt: new Date() },
  });
}

/** Posts a full mirror-image reversal of every ledger leg from the original cash-out
 * (WHT, treasury hold, fee, VAT, stamp, bank payout) — not a bare ad hoc credit — so
 * every tax sub-ledger nets back to zero and the user's balance is fully restored. */
export async function rejectCashoutRequest(requestId: string, adminId: string, notes?: string) {
  const request = await prisma.cashoutRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new Error("Cash-out request not found");
  if (request.status !== "PENDING") throw new Error(`Cannot reject from status ${request.status}`);

  if (request.taxTransactionId) {
    await reverseTaxTransaction(request.taxTransactionId, adminId);
  }

  return prisma.cashoutRequest.update({
    where: { id: requestId },
    data: { status: "REJECTED", processedByAdmin: adminId, processedAt: new Date(), notes },
  });
}
