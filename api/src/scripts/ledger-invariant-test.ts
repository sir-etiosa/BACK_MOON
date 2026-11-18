import { prisma } from "../db/prisma.js";
import {
  applyLedgerTransfer,
  getSystemAccountId,
  getUserAssetAccountId,
  InsufficientBalanceError,
  TX_OPTIONS,
} from "../ledger/ledger.service.js";

const NUM_USERS = 8;
const NUM_CONCURRENT_TRANSFERS = 60;
const BATCH_SIZE = 8; // keep concurrent in-flight transactions bounded against a remote DB
const INITIAL_CREDIT = 100_000n; // satoshi-equivalent units

async function main() {
  const assetRow = await prisma.asset.findFirst({ where: { symbol: "BTC" } });
  if (!assetRow) throw new Error("Run `npm run seed` first — BTC asset not found");
  const assetId = assetRow.id;

  const testTag = `invariant-test-${Date.now()}`;
  const users = await Promise.all(
    Array.from({ length: NUM_USERS }, (_, i) =>
      prisma.user.create({ data: { email: `${testTag}-${i}@test.local` } }),
    ),
  );

  const externalAccountId = await getSystemAccountId("EXTERNAL", assetId);
  const userAccountIds = await Promise.all(users.map((u) => getUserAssetAccountId(u.id, assetId)));

  // Fund every user with an identical starting balance via an idempotent, uniquely-refId'd transfer.
  await Promise.all(
    userAccountIds.map((accountId, i) =>
      prisma.$transaction(
        (tx) =>
          applyLedgerTransfer(tx, {
            fromAccountId: externalAccountId,
            toAccountId: accountId,
            assetId,
            amount: INITIAL_CREDIT.toString(),
            refType: "ADJUSTMENT",
            refId: `${testTag}-seed-${i}`,
          }),
        TX_OPTIONS,
      ),
    ),
  );

  const totalBefore = INITIAL_CREDIT * BigInt(NUM_USERS);

  let succeeded = 0;
  let rejectedForInsufficientFunds = 0;

  function runOne(i: number) {
    const fromIdx = Math.floor(Math.random() * userAccountIds.length);
    let toIdx = Math.floor(Math.random() * userAccountIds.length);
    while (toIdx === fromIdx) toIdx = Math.floor(Math.random() * userAccountIds.length);
    const amount = Math.floor(Math.random() * 5000) + 1;

    return prisma
      .$transaction(
        (tx) =>
          applyLedgerTransfer(tx, {
            fromAccountId: userAccountIds[fromIdx],
            toAccountId: userAccountIds[toIdx],
            assetId,
            amount: amount.toString(),
            refType: "SWAP",
            refId: `${testTag}-transfer-${i}`,
          }),
        TX_OPTIONS,
      )
      .then(() => {
        succeeded++;
      })
      .catch((err) => {
        if (err instanceof InsufficientBalanceError) {
          rejectedForInsufficientFunds++;
        } else {
          throw err;
        }
      });
  }

  for (let start = 0; start < NUM_CONCURRENT_TRANSFERS; start += BATCH_SIZE) {
    const batch = Array.from(
      { length: Math.min(BATCH_SIZE, NUM_CONCURRENT_TRANSFERS - start) },
      (_, j) => runOne(start + j),
    );
    await Promise.all(batch);
  }

  // EXTERNAL is a shared, permanent system account — every past run of this script
  // (and every real deposit/withdrawal in production) leaves its own entries on it
  // forever. Scoping by this run's own refId prefix (rather than "every entry ever
  // posted to these accounts") is what makes the invariant check about *this run's*
  // activity instead of accumulating false mismatches across repeated runs.
  const scopedAccountIds = [...userAccountIds, externalAccountId];

  const balances = await prisma.ledgerAccountBalance.findMany({
    where: { ledgerAccountId: { in: scopedAccountIds } },
  });
  const totalAfterUsers = balances
    .filter((b) => userAccountIds.includes(b.ledgerAccountId))
    .reduce((sum, b) => sum + BigInt(b.balance.toString()), 0n);

  const entries = await prisma.ledgerAccountEntry.findMany({
    where: { ledgerAccountId: { in: scopedAccountIds }, refId: { startsWith: testTag } },
  });

  const recomputed = new Map<string, bigint>();
  for (const id of scopedAccountIds) recomputed.set(id, 0n);
  let totalCredits = 0n;
  let totalDebits = 0n;
  for (const entry of entries) {
    const current = recomputed.get(entry.ledgerAccountId) ?? 0n;
    const delta = BigInt(entry.amount.toString());
    if (entry.direction === "CREDIT") {
      recomputed.set(entry.ledgerAccountId, current + delta);
      totalCredits += delta;
    } else {
      recomputed.set(entry.ledgerAccountId, current - delta);
      totalDebits += delta;
    }
  }

  // Only the ephemeral per-run user accounts have a *complete* history scoped by
  // testTag (they're brand new) — EXTERNAL's real balance reflects every run ever,
  // so it's excluded from this specific balance-equals-sum-of-its-own-entries check
  // (its contribution to the credits==debits check above already covers it).
  let mismatches = 0;
  for (const b of balances.filter((b) => userAccountIds.includes(b.ledgerAccountId))) {
    const fromLedger = recomputed.get(b.ledgerAccountId);
    if (fromLedger === undefined || fromLedger !== BigInt(b.balance.toString())) {
      mismatches++;
      console.error(
        `MISMATCH account=${b.ledgerAccountId} balance=${b.balance.toString()} recomputedFromLedger=${fromLedger}`,
      );
    }
  }

  console.log(`Concurrent transfers attempted: ${NUM_CONCURRENT_TRANSFERS}`);
  console.log(`Succeeded: ${succeeded}, rejected (insufficient funds): ${rejectedForInsufficientFunds}`);
  console.log(
    `Total user balance before: ${totalBefore}, after: ${totalAfterUsers} (must match — transfers net to zero among users)`,
  );
  console.log(
    `Total CREDIT entries: ${totalCredits}, total DEBIT entries: ${totalDebits} (must match — universal double-entry invariant, now spanning the EXTERNAL contra account too)`,
  );
  console.log(`Ledger-vs-balance mismatches: ${mismatches} (must be zero)`);

  // This run's ephemeral user accounts (and whatever they hold) are about to be
  // deleted outright, not transferred anywhere — so unwind EXTERNAL's resulting
  // balance with a direct adjustment rather than a transfer (there's no single
  // counterparty holding the combined total to debit). Keeps repeated runs from
  // leaving EXTERNAL drifting further negative forever.
  await prisma.ledgerAccountEntry.deleteMany({ where: { refId: { startsWith: testTag } } });
  await prisma.ledgerAccountBalance.update({
    where: { ledgerAccountId: externalAccountId },
    data: { balance: { increment: totalBefore.toString() } },
  });
  await prisma.posting.deleteMany({
    where: { OR: [{ fromAccountId: { in: userAccountIds } }, { toAccountId: { in: userAccountIds } }] },
  });
  await prisma.ledgerAccountBalance.deleteMany({ where: { ledgerAccountId: { in: userAccountIds } } });
  await prisma.ledgerAccount.deleteMany({ where: { id: { in: userAccountIds } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });

  if (totalAfterUsers !== totalBefore || mismatches > 0 || totalCredits !== totalDebits) {
    console.error("LEDGER INVARIANT TEST FAILED");
    process.exit(1);
  }
  console.log("LEDGER INVARIANT TEST PASSED");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
