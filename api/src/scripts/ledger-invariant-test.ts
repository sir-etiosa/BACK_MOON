import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { credit, transferInternal, InsufficientBalanceError } from "../ledger/ledger.service.js";

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

  // Fund every user with an identical starting balance via an idempotent, uniquely-refId'd credit.
  await Promise.all(
    users.map((u, i) =>
      credit({
        userId: u.id,
        assetId: assetId,
        amount: INITIAL_CREDIT.toString(),
        refType: "ADJUSTMENT",
        refId: `${testTag}-seed-${i}`,
      }),
    ),
  );

  const totalBefore = INITIAL_CREDIT * BigInt(NUM_USERS);

  let succeeded = 0;
  let rejectedForInsufficientFunds = 0;

  function runOne(i: number) {
    const from = users[Math.floor(Math.random() * users.length)];
    let to = users[Math.floor(Math.random() * users.length)];
    while (to.id === from.id) to = users[Math.floor(Math.random() * users.length)];
    const amount = Math.floor(Math.random() * 5000) + 1;

    return transferInternal({
      fromUserId: from.id,
      toUserId: to.id,
      assetId: assetId,
      amount: amount.toString(),
      refType: "TRADE",
      refId: `${testTag}-transfer-${i}`,
    })
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

  const balances = await prisma.balance.findMany({
    where: { userId: { in: users.map((u) => u.id) }, assetId: assetId },
  });
  const totalAfter = balances.reduce((sum, b) => sum + BigInt(b.balance.toString()), 0n);

  const ledgerEntries = await prisma.ledgerEntry.findMany({
    where: { userId: { in: users.map((u) => u.id) }, assetId: assetId },
  });

  const recomputed = new Map<string, bigint>();
  for (const u of users) recomputed.set(u.id, 0n);
  for (const entry of ledgerEntries) {
    const current = recomputed.get(entry.userId) ?? 0n;
    const delta = BigInt(entry.amount.toString());
    recomputed.set(entry.userId, entry.direction === "CREDIT" ? current + delta : current - delta);
  }

  let mismatches = 0;
  for (const b of balances) {
    const fromLedger = recomputed.get(b.userId);
    if (fromLedger === undefined || fromLedger !== BigInt(b.balance.toString())) {
      mismatches++;
      console.error(
        `MISMATCH user=${b.userId} balance=${b.balance.toString()} recomputedFromLedger=${fromLedger}`,
      );
    }
  }

  console.log(`Concurrent transfers attempted: ${NUM_CONCURRENT_TRANSFERS}`);
  console.log(`Succeeded: ${succeeded}, rejected (insufficient funds): ${rejectedForInsufficientFunds}`);
  console.log(`Total balance before: ${totalBefore}, after: ${totalAfter} (must match — transfers net to zero)`);
  console.log(`Ledger-vs-balance mismatches: ${mismatches} (must be zero)`);

  await prisma.ledgerEntry.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.balance.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });

  if (totalAfter !== totalBefore || mismatches > 0) {
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
