import { prisma } from "../../db/prisma.js";
import { applyLedgerTransfer, TX_OPTIONS } from "../../ledger/ledger.service.js";
import { recordAudit } from "./audit.service.js";

/**
 * Posts a full mirror-image reversal of every leg in a completed tax transaction —
 * not a bare ad hoc credit like the pre-tax-engine reject flows used to do. Shared by
 * cashout rejection and (later) bill-payment rejection. The reversal gets its own
 * `TaxTransaction` row (no backing `TaxQuote` — see schema) linked via
 * `reversedByTransactionId`, so every tax sub-ledger nets back to zero for the
 * original transaction and the user's balance is fully restored.
 */
export async function reverseTaxTransaction(originalTransactionId: string, adminId: string) {
  const original = await prisma.taxTransaction.findUniqueOrThrow({
    where: { id: originalTransactionId },
    include: { postings: { orderBy: { legIndex: "asc" } } },
  });
  if (original.status !== "COMPLETED") {
    throw new Error(`Cannot reverse a transaction with status ${original.status}`);
  }

  return prisma.$transaction(async (tx) => {
    const reversal = await tx.taxTransaction.create({
      data: {
        userId: original.userId,
        eventType: original.eventType,
        status: "PENDING",
        idempotencyKey: `reversal:${original.id}`,
      },
    });

    // refId is unique per leg (not just per reversal) — the same collision risk as
    // the forward posting helpers: a shared clearing/suspense account can legitimately
    // be the "to" side of more than one reversed leg.
    let legIndex = 0;
    for (const posting of original.postings) {
      const idx = legIndex++;
      await applyLedgerTransfer(tx, {
        fromAccountId: posting.toAccountId,
        toAccountId: posting.fromAccountId,
        assetId: posting.assetId,
        amount: posting.amount,
        refType: "REVERSAL",
        refId: `${reversal.id}:${idx}`,
        transactionId: reversal.id,
        legIndex: idx,
      });
    }

    await tx.taxTransaction.update({ where: { id: reversal.id }, data: { status: "COMPLETED" } });
    await tx.taxTransaction.update({ where: { id: original.id }, data: { status: "REVERSED", reversedByTransactionId: reversal.id } });

    await recordAudit({
      actorType: "admin",
      actorId: adminId,
      action: "transaction.reverse",
      entityType: "TaxTransaction",
      entityId: original.id,
      before: { status: original.status },
      after: { status: "REVERSED", reversedByTransactionId: reversal.id },
    });

    return reversal;
  }, TX_OPTIONS);
}
