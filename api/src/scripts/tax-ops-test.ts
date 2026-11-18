import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { applyLedgerTransfer, getAccountBalance, getSystemAccountId, getUserAssetAccountId, TX_OPTIONS } from "../ledger/ledger.service.js";
import { executeTaxedCashout } from "../modules/tax/cashout.service.js";
import { createSweep, getAccruedTaxLiability } from "../modules/tax/sweep.service.js";
import { createRemittance } from "../modules/tax/remittance.service.js";
import { runReconciliation } from "../modules/tax/reconciliation.service.js";
import { setNgnRate } from "../modules/admin/settings.service.js";

/** Exercises sweeps, remittance, and reconciliation end to end against a real
 * non-stablecoin cash-out's accrued tax. Run via `npm run test:tax-ops`. */

let failures = 0;
function assertTrue(label: string, condition: boolean) {
  if (!condition) {
    failures++;
    console.error(`FAIL ${label}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

async function main() {
  const testTag = `tax-ops-test-${Date.now()}`;
  await setNgnRate(1500, "system-seed");

  const eth = await prisma.asset.findFirstOrThrow({ where: { symbol: "ETH", chain: "evm" } });
  const ngn = await prisma.asset.findUniqueOrThrow({ where: { symbol_chain: { symbol: "XCH", chain: "fiat" } } });

  // Snapshot every balance this test will touch so cleanup can restore it exactly.
  const touchedAccountIds = await Promise.all([
    getSystemAccountId("TREASURY", eth.id),
    getSystemAccountId("TREASURY", ngn.id),
    getSystemAccountId("TAX_WALLET", eth.id),
    getSystemAccountId("TAX_WALLET", ngn.id),
    getSystemAccountId("TAX_WHT", eth.id, "WHT"),
    getSystemAccountId("TAX_VAT", ngn.id, "VAT"),
    getSystemAccountId("TAX_STAMP", ngn.id, "STAMP"),
    getSystemAccountId("NRS_REMITTED", eth.id, "WHT"),
    getSystemAccountId("EXTERNAL", eth.id),
    getSystemAccountId("EXTERNAL", ngn.id),
  ]);
  const [
    treasuryEthId, treasuryNgnId, taxWalletEthId, taxWalletNgnId,
    taxWhtEthId, taxVatNgnId, taxStampNgnId, nrsRemittedWhtEthId, externalEthId, externalNgnId,
  ] = touchedAccountIds;
  const before = new Map<string, Prisma.Decimal>();
  for (const id of touchedAccountIds) before.set(id, await getAccountBalance(id));

  // Fund treasury (counterparty for the cashout's token-sold and NGN-payout legs).
  const fundRefIds: string[] = [];
  async function fundTreasury(assetId: string, accountId: string, amount: string) {
    const externalAccountId = await getSystemAccountId("EXTERNAL", assetId);
    const refId = `${testTag}-fund-${accountId}`;
    fundRefIds.push(refId);
    await prisma.$transaction(
      (tx) => applyLedgerTransfer(tx, { fromAccountId: externalAccountId, toAccountId: accountId, assetId, amount, refType: "ADJUSTMENT", refId }),
      TX_OPTIONS,
    );
  }
  await fundTreasury(eth.id, treasuryEthId, (10n ** 18n).toString());
  await fundTreasury(ngn.id, treasuryNgnId, (10_000_000n * 100n).toString());

  const user = await prisma.user.create({ data: { email: `${testTag}@test.local` } });
  const userEthAccountId = await getUserAssetAccountId(user.id, eth.id);
  await prisma.$transaction(
    (tx) => applyLedgerTransfer(tx, { fromAccountId: externalEthId, toAccountId: userEthAccountId, assetId: eth.id, amount: (10n ** 17n).toString(), refType: "ADJUSTMENT", refId: `${testTag}-fund-user` }),
    TX_OPTIONS,
  );
  fundRefIds.push(`${testTag}-fund-user`);

  await prisma.cashoutProfile.create({ data: { userId: user.id, firstName: "Ops", lastName: "Test", verifiedAt: new Date(), completedAt: new Date() } });
  const bankAccount = await prisma.cashoutBankAccount.create({ data: { userId: user.id, bankName: "Test Bank", accountNumber: "0000000000", isDefault: true } });

  const cashoutRequest = await executeTaxedCashout({ userId: user.id, sourceAssetId: eth.id, ngnAmount: "50000", bankAccountId: bankAccount.id });

  const whtAccrued = await getAccruedTaxLiability("WHT", eth.id);
  assertTrue("WHT accrued from the cashout before any sweep", whtAccrued > 0n);

  // --- Sweep: moves custody from treasury into the dedicated tax wallet -----------
  // Note: the sweep's own size is based on cumulative-ever-credited minus
  // already-swept (see sweep.service.ts) — NOT the current liability balance, which
  // can diverge from it (e.g. after a remittance, or on a shared ledger with other
  // history). So the assertions below check the sweep's *own* amount is self-
  // consistent with its effects, not that it equals `whtAccrued` from this run alone.
  const taxWalletEthBefore = await getAccountBalance(taxWalletEthId);
  const treasuryEthBeforeSweep = await getAccountBalance(treasuryEthId);
  const sweep = await createSweep({ taxType: "WHT", assetId: eth.id, adminId: "system-seed" });
  assertTrue("sweep amount is at least this run's own accrued WHT", BigInt(sweep.amountMinor.toString()) >= whtAccrued);
  const treasuryEthAfterSweep = await getAccountBalance(treasuryEthId);
  assertTrue(
    "sweep debited treasury:ETH by exactly its own amount",
    treasuryEthBeforeSweep.minus(treasuryEthAfterSweep).eq(new Prisma.Decimal(sweep.amountMinor.toString())),
  );
  const taxWalletEthBalance = await getAccountBalance(taxWalletEthId);
  assertTrue(
    "sweep credited tax_wallet:ETH by exactly its own amount",
    taxWalletEthBalance.minus(taxWalletEthBefore).eq(new Prisma.Decimal(sweep.amountMinor.toString())),
  );
  assertTrue("tax:WHT:ETH sub-ledger untouched by the sweep (still the liability record)", (await getAccruedTaxLiability("WHT", eth.id)) === whtAccrued);

  await assertThrowsNothingToSweep();
  async function assertThrowsNothingToSweep() {
    try {
      await createSweep({ taxType: "WHT", assetId: eth.id, adminId: "system-seed" });
      failures++;
      console.error("FAIL sweeping an already-swept, zero-accrual tax type should throw");
    } catch {
      console.log("ok   sweeping again with nothing accrued throws");
    }
  }

  // --- Remittance: clears the liability sub-ledger, independent of custody --------
  const remittance = await createRemittance({
    taxType: "WHT",
    assetId: eth.id,
    amountMinor: whtAccrued.toString(),
    periodStart: new Date("2026-11-01"),
    periodEnd: new Date("2026-11-30"),
    nrsReceiptRef: "NRS-TEST-0001",
    adminId: "system-seed",
  });
  assertTrue("remittance recorded as PAID", remittance.status === "PAID");
  assertTrue("tax:WHT:ETH liability cleared after remittance", (await getAccruedTaxLiability("WHT", eth.id)) === 0n);
  const nrsRemittedBalance = await getAccountBalance(nrsRemittedWhtEthId);
  assertTrue("nrs:remitted:WHT:ETH credited by the remitted amount", nrsRemittedBalance.eq(new Prisma.Decimal(whtAccrued.toString())));

  // --- Reconciliation: internal custody self-consistency check --------------------
  const run = await runReconciliation();
  const resultsJson = run.resultsJson as Array<Record<string, unknown>>;
  const ethCustodyRow = resultsJson.find((r) => r.assetId === eth.id && "custodySelfConsistent" in r);
  assertTrue("reconciliation recorded a custody row for ETH", ethCustodyRow !== undefined);
  assertTrue("reconciliation found tax_wallet:ETH self-consistent with its sweep history", ethCustodyRow?.custodySelfConsistent === true);

  // --- Cleanup: restore every touched balance exactly, delete everything created --
  const userAccountIds = (await prisma.ledgerAccount.findMany({ where: { userId: user.id } })).map((a) => a.id);
  await prisma.taxEvent.deleteMany({ where: { userId: user.id } });
  await prisma.cashoutBankAccount.deleteMany({ where: { userId: user.id } });
  await prisma.cashoutProfile.deleteMany({ where: { userId: user.id } });
  await prisma.cashoutRequest.deleteMany({ where: { userId: user.id } });
  const txIds = (await prisma.taxTransaction.findMany({ where: { userId: user.id } })).map((t) => t.id);
  await prisma.posting.deleteMany({
    where: { OR: [{ transactionId: { in: txIds } }, { refType: "SWEEP" }, { refType: "REMITTANCE" }, { fromAccountId: { in: userAccountIds } }, { toAccountId: { in: userAccountIds } }] },
  });
  await prisma.taxTransaction.deleteMany({ where: { userId: user.id } });
  await prisma.taxQuote.deleteMany({ where: { userId: user.id } });
  await prisma.taxSweep.deleteMany({ where: { id: sweep.id } });
  await prisma.taxRemittance.deleteMany({ where: { id: remittance.id } });
  await prisma.taxReconciliationRun.deleteMany({ where: { id: run.id } });
  await prisma.ledgerAccountEntry.deleteMany({ where: { OR: [{ ledgerAccountId: { in: userAccountIds } }, { refId: { startsWith: testTag } }, { refId: sweep.id }, { refId: remittance.id }] } });
  await prisma.ledgerAccountBalance.deleteMany({ where: { ledgerAccountId: { in: userAccountIds } } });
  await prisma.ledgerAccount.deleteMany({ where: { id: { in: userAccountIds } } });
  await prisma.user.deleteMany({ where: { id: user.id } });

  for (const [id, balance] of before) {
    await prisma.ledgerAccountBalance.update({ where: { ledgerAccountId: id }, data: { balance } });
  }

  if (failures > 0) {
    console.error(`\n${failures} TAX OPS ASSERTION(S) FAILED`);
    process.exit(1);
  }
  console.log("\nALL TAX OPS ASSERTIONS PASSED");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
