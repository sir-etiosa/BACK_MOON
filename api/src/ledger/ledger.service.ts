import { Prisma, LedgerDirection, LedgerRefType } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma.js";

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export class InsufficientBalanceError extends Error {
  constructor(userId: string, assetId: string) {
    super(`Insufficient balance for user ${userId} asset ${assetId}`);
  }
}

interface Movement {
  userId: string;
  assetId: string;
  direction: LedgerDirection;
  amount: Prisma.Decimal | string | number;
  refType: LedgerRefType;
  refId: string;
}

/**
 * Applies one ledger movement atomically: locks the balance row (SELECT ... FOR UPDATE),
 * mutates it, and writes the matching immutable ledger_entries row in the same DB transaction.
 * Must always be called with a `tx` that came from prisma.$transaction — never on the bare client,
 * or the row lock has nothing to serialize against.
 */
export async function applyLedgerMovement(tx: Tx, m: Movement): Promise<void> {
  const amount = new Prisma.Decimal(m.amount);
  if (amount.lte(0)) {
    throw new Error("Ledger movement amount must be positive");
  }

  // Row must exist before FOR UPDATE can lock it.
  await tx.balance.upsert({
    where: { userId_assetId: { userId: m.userId, assetId: m.assetId } },
    create: { userId: m.userId, assetId: m.assetId, balance: new Prisma.Decimal(0) },
    update: {},
  });

  const locked = await tx.$queryRaw<{ balance: Prisma.Decimal }[]>`
    SELECT balance FROM balances WHERE user_id = ${m.userId} AND asset_id = ${m.assetId} FOR UPDATE
  `;
  const current = new Prisma.Decimal(locked[0].balance);

  const next = m.direction === "CREDIT" ? current.plus(amount) : current.minus(amount);
  if (next.lt(0)) {
    throw new InsufficientBalanceError(m.userId, m.assetId);
  }

  await tx.balance.update({
    where: { userId_assetId: { userId: m.userId, assetId: m.assetId } },
    data: { balance: next },
  });

  // Unique(refType, refId, userId, direction) makes this idempotent: a retried
  // credit/debit for the same deposit/withdrawal/trade leg throws instead of double-applying.
  await tx.ledgerEntry.create({
    data: {
      userId: m.userId,
      assetId: m.assetId,
      direction: m.direction,
      amount,
      refType: m.refType,
      refId: m.refId,
      balanceAfter: next,
    },
  });
}

export const TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 };

/**
 * Applies several ledger legs in one transaction, always locking the underlying
 * (user, asset) balance rows in a fixed canonical order. Without this, two concurrent
 * multi-leg operations touching the same rows in opposite order (e.g. A->B and B->A)
 * can lock in opposite order and deadlock under load — sorting first makes every
 * caller agree on lock order regardless of which leg is a debit or a credit.
 */
export async function applyLedgerMovements(tx: Tx, movements: Movement[]): Promise<void> {
  const ordered = [...movements].sort((a, b) =>
    `${a.userId}:${a.assetId}`.localeCompare(`${b.userId}:${b.assetId}`),
  );
  for (const m of ordered) {
    await applyLedgerMovement(tx, m);
  }
}

export async function credit(input: Omit<Movement, "direction">): Promise<void> {
  await prisma.$transaction(
    (tx) => applyLedgerMovement(tx, { ...input, direction: "CREDIT" }),
    TX_OPTIONS,
  );
}

export async function debit(input: Omit<Movement, "direction">): Promise<void> {
  await prisma.$transaction(
    (tx) => applyLedgerMovement(tx, { ...input, direction: "DEBIT" }),
    TX_OPTIONS,
  );
}

/**
 * Two legs, one atomic transaction: used for internal trades/P2P and any other
 * move where both sides must succeed or both must roll back together.
 */
export async function transferInternal(input: {
  fromUserId: string;
  toUserId: string;
  assetId: string;
  amount: Prisma.Decimal | string | number;
  refType: LedgerRefType;
  refId: string;
}): Promise<void> {
  await prisma.$transaction(
    (tx) =>
      applyLedgerMovements(tx, [
        {
          userId: input.fromUserId,
          assetId: input.assetId,
          direction: "DEBIT",
          amount: input.amount,
          refType: input.refType,
          refId: input.refId,
        },
        {
          userId: input.toUserId,
          assetId: input.assetId,
          direction: "CREDIT",
          amount: input.amount,
          refType: input.refType,
          refId: input.refId,
        },
      ]),
    TX_OPTIONS,
  );
}

export async function getBalance(userId: string, assetId: string): Promise<Prisma.Decimal> {
  const row = await prisma.balance.findUnique({ where: { userId_assetId: { userId, assetId } } });
  return row?.balance ?? new Prisma.Decimal(0);
}
