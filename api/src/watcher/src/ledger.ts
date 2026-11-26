import { Prisma, LedgerDirection, LedgerAccountType, PostingRefType, TaxType } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "./db.js";

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export class InsufficientBalanceError extends Error {
  constructor(ledgerAccountId: string) {
    super(`Insufficient balance for ledger account ${ledgerAccountId}`);
  }
}

/** System accounts (everything but USER_ASSET) are suspense/clearing/contra accounts —
 * money in flight or owed, not custodied value — so they're allowed to run negative.
 * Only USER_ASSET/TREASURY/HOT_WALLET/TAX_WALLET represent real custodied balances and
 * must never go below zero. */
function allowNegativeFor(type: LedgerAccountType): boolean {
  return type !== "USER_ASSET" && type !== "TREASURY" && type !== "HOT_WALLET" && type !== "TAX_WALLET";
}

function systemAccountCode(type: LedgerAccountType, assetId: string, taxType?: TaxType): string {
  switch (type) {
    case "TREASURY":
      return `treasury:${assetId}`;
    case "HOT_WALLET":
      return `hot_wallet:${assetId}`;
    case "TAX_WALLET":
      return `tax_wallet:${assetId}`;
    case "REVENUE_FEES":
      return `revenue:fees:${assetId}`;
    case "TAX_WHT":
      return `tax:WHT:${assetId}`;
    case "TAX_VAT":
      return `tax:VAT:${assetId}`;
    case "TAX_STAMP":
      return `tax:STAMP:${assetId}`;
    case "PAYOUT_CLEARING":
      return `payout:clearing:${assetId}`;
    case "BILLS_CLEARING":
      return `bills:clearing:${assetId}`;
    case "BANK_PAYOUT":
      return `bank:payout:${assetId}`;
    case "BILLER_SETTLEMENT":
      return `biller:settlement:${assetId}`;
    case "NRS_REMITTED":
      if (!taxType) throw new Error("NRS_REMITTED account requires a taxType");
      return `nrs:remitted:${taxType}:${assetId}`;
    case "EXTERNAL":
      return `external:${assetId}`;
    case "USER_ASSET":
      throw new Error("Use getUserAssetAccountId for USER_ASSET accounts");
  }
}

const accountIdCache = new Map<string, string>();

/** Get-or-create a user's per-asset account, memoized in-process. Replaces the old
 * implicit lazy-upsert that `applyLedgerMovement` used to do on `Balance`. */
export async function getUserAssetAccountId(userId: string, assetId: string): Promise<string> {
  const code = `user:${userId}:${assetId}`;
  const cached = accountIdCache.get(code);
  if (cached) return cached;

  const account = await prisma.ledgerAccount.upsert({
    where: { code },
    create: { code, type: "USER_ASSET", assetId, userId, allowNegative: false },
    update: {},
  });
  await prisma.ledgerAccountBalance.upsert({
    where: { ledgerAccountId: account.id },
    create: { ledgerAccountId: account.id, balance: new Prisma.Decimal(0) },
    update: {},
  });
  accountIdCache.set(code, account.id);
  return account.id;
}

/** Get-or-create a system (non-user) account — treasury, tax sub-ledgers, revenue,
 * clearing, etc. — memoized in-process. Replaces `house.ts`'s single memoized house
 * user id with a general-purpose equivalent for every non-user account type. */
export async function getSystemAccountId(
  type: Exclude<LedgerAccountType, "USER_ASSET">,
  assetId: string,
  taxType?: TaxType,
): Promise<string> {
  const code = systemAccountCode(type, assetId, taxType);
  const cached = accountIdCache.get(code);
  if (cached) return cached;

  const account = await prisma.ledgerAccount.upsert({
    where: { code },
    create: { code, type, assetId, taxType, allowNegative: allowNegativeFor(type) },
    update: {},
  });
  await prisma.ledgerAccountBalance.upsert({
    where: { ledgerAccountId: account.id },
    create: { ledgerAccountId: account.id, balance: new Prisma.Decimal(0) },
    update: {},
  });
  accountIdCache.set(code, account.id);
  return account.id;
}

export interface Transfer {
  fromAccountId: string;
  toAccountId: string;
  assetId: string;
  amount: Prisma.Decimal | string | number | bigint;
  refType: PostingRefType;
  refId: string;
  transactionId?: string;
  legIndex?: number;
}

async function lockAndRead(tx: Tx, ledgerAccountId: string): Promise<Prisma.Decimal> {
  const locked = await tx.$queryRaw<{ balance: Prisma.Decimal }[]>`
    SELECT balance FROM ledger_account_balances WHERE ledger_account_id = ${ledgerAccountId} FOR UPDATE
  `;
  return new Prisma.Decimal(locked[0].balance);
}

/**
 * Applies one double-entry transfer atomically: locks both accounts' balance rows
 * (`SELECT ... FOR UPDATE`, always in canonical id order so two concurrent transfers
 * touching the same pair of accounts in opposite directions can't deadlock), moves
 * `amount` from `fromAccountId` to `toAccountId`, writes the paired DEBIT/CREDIT
 * `LedgerAccountEntry` rows (same dedupe discipline as the legacy ledger — a retried
 * leg with the same refType+refId+account+direction throws instead of double-applying)
 * plus one human-readable `Posting` row. Must be called with a `tx` from
 * `prisma.$transaction` — the row locks are meaningless outside one.
 */
export async function applyLedgerTransfer(tx: Tx, t: Transfer): Promise<{ postingId: string }> {
  const amount = new Prisma.Decimal(typeof t.amount === "bigint" ? t.amount.toString() : t.amount);
  if (amount.lte(0)) {
    throw new Error("Transfer amount must be positive");
  }
  if (t.fromAccountId === t.toAccountId) {
    throw new Error("Transfer must move between two different accounts");
  }

  const [firstId, secondId] = [t.fromAccountId, t.toAccountId].sort();
  const balances = new Map<string, Prisma.Decimal>();
  balances.set(firstId, await lockAndRead(tx, firstId));
  balances.set(secondId, await lockAndRead(tx, secondId));

  const fromAccount = await tx.ledgerAccount.findUniqueOrThrow({ where: { id: t.fromAccountId } });

  const fromCurrent = balances.get(t.fromAccountId)!;
  const toCurrent = balances.get(t.toAccountId)!;
  const fromNext = fromCurrent.minus(amount);
  const toNext = toCurrent.plus(amount);

  if (fromNext.lt(0) && !fromAccount.allowNegative) {
    throw new InsufficientBalanceError(t.fromAccountId);
  }

  await tx.ledgerAccountBalance.update({ where: { ledgerAccountId: t.fromAccountId }, data: { balance: fromNext } });
  await tx.ledgerAccountBalance.update({ where: { ledgerAccountId: t.toAccountId }, data: { balance: toNext } });

  await tx.ledgerAccountEntry.create({
    data: {
      ledgerAccountId: t.fromAccountId,
      direction: "DEBIT",
      amount,
      refType: t.refType,
      refId: t.refId,
      balanceAfter: fromNext,
    },
  });
  await tx.ledgerAccountEntry.create({
    data: {
      ledgerAccountId: t.toAccountId,
      direction: "CREDIT",
      amount,
      refType: t.refType,
      refId: t.refId,
      balanceAfter: toNext,
    },
  });

  const posting = await tx.posting.create({
    data: {
      transactionId: t.transactionId,
      legIndex: t.legIndex ?? 0,
      fromAccountId: t.fromAccountId,
      toAccountId: t.toAccountId,
      assetId: t.assetId,
      amount,
      refType: t.refType,
      refId: t.refId,
    },
  });

  return { postingId: posting.id };
}

export const TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 };

/**
 * Applies several transfers in one transaction, sorted by the canonical pair of
 * accounts each one touches — generalizes the legacy `applyLedgerMovements`' "sort by
 * userId:assetId" rule to avoid deadlock across whichever two accounts a leg moves
 * between, not just one (userId, assetId) row.
 */
export async function applyLedgerTransfers(tx: Tx, transfers: Transfer[]): Promise<{ postingIds: string[] }> {
  const ordered = [...transfers].sort((a, b) => {
    const keyA = [a.fromAccountId, a.toAccountId].sort().join(":");
    const keyB = [b.fromAccountId, b.toAccountId].sort().join(":");
    return keyA.localeCompare(keyB);
  });

  const postingIds: string[] = [];
  for (const t of ordered) {
    const { postingId } = await applyLedgerTransfer(tx, t);
    postingIds.push(postingId);
  }
  return { postingIds };
}

export async function getAccountBalance(ledgerAccountId: string): Promise<Prisma.Decimal> {
  const row = await prisma.ledgerAccountBalance.findUnique({ where: { ledgerAccountId } });
  return row?.balance ?? new Prisma.Decimal(0);
}

/** Convenience wrapper matching the legacy `getBalance(userId, assetId)` signature. */
export async function getUserAssetBalance(userId: string, assetId: string): Promise<Prisma.Decimal> {
  const accountId = await getUserAssetAccountId(userId, assetId);
  return getAccountBalance(accountId);
}

export { LedgerDirection, PostingRefType };
