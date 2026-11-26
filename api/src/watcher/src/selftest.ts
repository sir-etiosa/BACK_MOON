import { buildTasks, parseChainList, DEFAULT_CHAINS } from "./tasks.js";

// Config-only checks — no DB, no network. Safe to run anywhere.
function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok  ${msg}`);
}

function expectThrow(fn: () => unknown, msg: string) {
  try {
    fn();
  } catch {
    console.log(`ok  ${msg}`);
    return;
  }
  throw new Error(`FAIL (expected throw): ${msg}`);
}

check(parseChainList(undefined).join(",") === DEFAULT_CHAINS.join(","), "defaults to the five GitHub-Actions chains");
check(parseChainList("evm").join(",") === "evm", "parses a single chain");
check(parseChainList(" EVM , Tron ,btc ").join(",") === "evm,tron,btc", "trims, lowercases, de-dupes");
check(parseChainList("evm,evm,evm").length === 1, "collapses duplicates");
expectThrow(() => parseChainList("doge"), "rejects an unknown chain");
expectThrow(() => parseChainList(","), "rejects an empty chain list");

const tasks = buildTasks(parseChainList("evm,tron,btc,ltc,solana"));
check(tasks.length === 5, "builds one task per chain");
check(tasks.every((t) => typeof t.run === "function"), "every task has a run()");
check(new Set(tasks.map((t) => t.chain)).size === 5, "chain names are unique");

if (process.env.RUN_DB_TESTS === "1") {
  await runDbTests();
} else {
  console.log("\n(skipping DB/credit tests — set RUN_DB_TESTS=1 to include them)");
}

console.log("\nSELFTEST PASSED");

async function runDbTests() {
  const { prisma } = await import("./db.js");
  const { recordAndCreditIfReady } = await import("./watchers/deposit-helper.js");
  const { getAccountBalance, getUserAssetAccountId } = await import("./ledger.js");

  const tag = `watcher-selftest-${Date.now()}`;
  let userId: string | undefined;
  let assetId: string | undefined;
  let externalAccountId: string | undefined;
  let depositRowIds: string[] = [];
  try {
    // Self-contained: works on a brand-new database with nothing seeded.
    const asset = await prisma.asset.upsert({
      where: { symbol_chain: { symbol: "BTC", chain: "bitcoin" } },
      create: { symbol: "BTC", chain: "bitcoin", decimals: 8, category: "NON_STABLE" },
      update: {},
    });
    assetId = asset.id;
    const user = await prisma.user.create({ data: { email: `${tag}@test.local` } });
    userId = user.id;

    const address = `selftest-${tag}`;
    const amount = "150000"; // 0.0015 BTC in sats
    const base = {
      userId: user.id,
      assetId: asset.id,
      address,
      txHash: `${tag}-tx`,
      amount,
      requiredConfirmations: 2,
    };

    const first = await recordAndCreditIfReady({ ...base, confirmations: 1 });
    check(first.status === "PENDING", "below required confirmations stays PENDING");

    const second = await recordAndCreditIfReady({ ...base, confirmations: 2 });
    check(second.status === "CREDITED", "meeting confirmations credits the deposit");
    check(second.justCredited === true, "the run that credits reports justCredited=true");

    const balance = await getAccountBalance(await getUserAssetAccountId(user.id, asset.id));
    check(balance.toString() === amount, "user's ledger balance equals the deposit amount");

    // The critical property: re-observing the same tx (every run does this) must not
    // double-credit.
    const third = await recordAndCreditIfReady({ ...base, confirmations: 5 });
    check(third.status === "CREDITED", "re-observation still reports CREDITED");
    check(third.justCredited === false, "re-observation reports justCredited=false (no phantom credits in logs)");
    const balanceAfter = await getAccountBalance(await getUserAssetAccountId(user.id, asset.id));
    check(balanceAfter.toString() === amount, "re-observation does NOT double-credit");

    const depositCount = await prisma.deposit.count({ where: { txHash: `${tag}-tx`, address } });
    check(depositCount === 1, "exactly one deposit row for the tx");
  } finally {
    // Full cleanup so repeated runs leave nothing behind.
    if (userId && assetId) {
      depositRowIds = (
        await prisma.deposit.findMany({ where: { userId }, select: { id: true } })
      ).map((d) => d.id);

      const account = await prisma.ledgerAccount.findUnique({ where: { code: `user:${userId}:${assetId}` } });
      if (account) {
        await prisma.ledgerAccountEntry.deleteMany({ where: { ledgerAccountId: account.id } });
        await prisma.ledgerAccountBalance.deleteMany({ where: { ledgerAccountId: account.id } });
        await prisma.posting.deleteMany({ where: { OR: [{ fromAccountId: account.id }, { toAccountId: account.id }] } });
        await prisma.ledgerAccount.delete({ where: { id: account.id } });
      }

      // The credit also left a DEBIT on the shared EXTERNAL account, keyed by deposit id.
      const external = await prisma.ledgerAccount.findUnique({ where: { code: `external:${assetId}` } });
      externalAccountId = external?.id;
      if (externalAccountId && depositRowIds.length) {
        await prisma.ledgerAccountEntry.deleteMany({
          where: { ledgerAccountId: externalAccountId, refId: { in: depositRowIds } },
        });
        await prisma.posting.deleteMany({
          where: { refId: { in: depositRowIds }, fromAccountId: externalAccountId },
        });
      }

      await prisma.deposit.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  }
}
