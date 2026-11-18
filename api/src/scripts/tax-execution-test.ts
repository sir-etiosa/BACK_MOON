import { prisma } from "../db/prisma.js";
import { applyLedgerTransfer, getSystemAccountId, getUserAssetAccountId, TX_OPTIONS } from "../ledger/ledger.service.js";
import { executeTaxedSwap } from "../modules/tax/swap.service.js";
import { executeTaxedCashout } from "../modules/tax/cashout.service.js";
import { executeTaxedBillPayment } from "../modules/tax/bill.service.js";
import { reverseTaxTransaction } from "../modules/tax/reversal.service.js";
import { setNgnRate } from "../modules/admin/settings.service.js";

/**
 * End-to-end against the real DB (live price feed — exact brief figures aren't
 * assertable here since prices move; see tax-vectors-test.ts for that). Verifies
 * structural correctness: the right accounts get touched, the ledger's double-entry
 * invariant holds for everything this test itself posted, WHT applies to
 * non-stablecoins and not to stablecoins, and a rejection fully reverses. Run via
 * `npm run test:tax-execution`.
 */

let failures = 0;
function assertTrue(label: string, condition: boolean) {
  if (!condition) {
    failures++;
    console.error(`FAIL ${label}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

const testRefIds: string[] = [];

async function fund(userId: string, assetId: string, amount: string) {
  const userAccountId = await getUserAssetAccountId(userId, assetId);
  const externalAccountId = await getSystemAccountId("EXTERNAL", assetId);
  const refId = `test-fund-${Date.now()}-${Math.random()}`;
  testRefIds.push(refId);
  await prisma.$transaction(
    (tx) =>
      applyLedgerTransfer(tx, { fromAccountId: externalAccountId, toAccountId: userAccountId, assetId, amount, refType: "ADJUSTMENT", refId }),
    TX_OPTIONS,
  );
}

/** Treasury is the swap/cashout counterparty and — like the house account before it —
 * can never go negative, so it needs real inventory before it can pay out either side
 * of a trade. In production this comes from actual liquidity operations; here it's
 * the test's own setup step, exactly like `fund()` above but into TREASURY instead of
 * a user account. */
async function fundTreasury(assetId: string, amount: string) {
  const treasuryAccountId = await getSystemAccountId("TREASURY", assetId);
  const externalAccountId = await getSystemAccountId("EXTERNAL", assetId);
  const refId = `test-fund-treasury-${Date.now()}-${Math.random()}`;
  testRefIds.push(refId);
  await prisma.$transaction(
    (tx) =>
      applyLedgerTransfer(tx, { fromAccountId: externalAccountId, toAccountId: treasuryAccountId, assetId, amount, refType: "ADJUSTMENT", refId }),
    TX_OPTIONS,
  );
}

async function main() {
  const testTag = `tax-exec-test-${Date.now()}`;
  await setNgnRate(1500, "system-seed");

  const [eth, usdc, usdt] = await Promise.all([
    prisma.asset.findFirstOrThrow({ where: { symbol: "ETH", chain: "evm" } }),
    prisma.asset.findFirstOrThrow({ where: { symbol: "USDC", chain: "evm" } }),
    prisma.asset.findFirstOrThrow({ where: { symbol: "USDT" } }),
  ]);
  const ngn = await prisma.asset.findUniqueOrThrow({ where: { symbol_chain: { symbol: "XCH", chain: "fiat" } } });

  // Treasury is the counterparty on both the swap's proceeds leg and the cashout's
  // NGN payout leg — give it real inventory first, same as production liquidity ops.
  await fundTreasury(usdc.id, (1_000_000n * 10n ** 6n).toString());
  await fundTreasury(ngn.id, (100_000_000n * 100n).toString());

  // --- Swap: non-stablecoin ETH -> USDC --------------------------------------------
  const swapUser = await prisma.user.create({ data: { email: `${testTag}-swap@test.local` } });
  await fund(swapUser.id, eth.id, (10n ** 17n).toString()); // 0.1 ETH

  const { taxTransaction: swapTx, breakdown: swapBreakdown } = await executeTaxedSwap({
    userId: swapUser.id,
    fromSymbol: "ETH",
    amountFrom: (10n ** 17n).toString(),
    assetToId: usdc.id,
  });
  testRefIds.push(swapTx.id); // refIds are "<txId>:<legIndex>" — prefix match below

  assertTrue("swap WHT > 0 for non-stablecoin", swapBreakdown.whtToken > 0n);
  assertTrue("swap fee > 0", swapBreakdown.feeToken > 0n);
  assertTrue("swap VAT > 0", swapBreakdown.vatToken > 0n);
  assertTrue("swap proceeds > 0", swapBreakdown.proceeds > 0n);

  const swapPostings = await prisma.posting.findMany({ where: { transactionId: swapTx.id }, include: { fromAccount: true, toAccount: true } });
  assertTrue("swap posted a leg into tax:WHT", swapPostings.some((p) => p.toAccount.type === "TAX_WHT"));
  assertTrue("swap posted a leg into revenue:fees", swapPostings.some((p) => p.toAccount.type === "REVENUE_FEES"));
  assertTrue("swap posted a leg into tax:VAT", swapPostings.some((p) => p.toAccount.type === "TAX_VAT"));
  assertTrue("swap posted a leg into treasury", swapPostings.some((p) => p.toAccount.type === "TREASURY"));
  assertTrue("swap posted the proceeds leg from treasury to the user", swapPostings.some((p) => p.fromAccount.type === "TREASURY" && p.toAccount.type === "USER_ASSET"));

  const swapEvent = await prisma.taxEvent.findFirst({ where: { transactionId: swapTx.id } });
  assertTrue("swap recorded a TaxEvent", swapEvent !== null);
  const swapLot = await prisma.acquisitionLot.findFirst({ where: { sourceTransactionId: swapTx.id } });
  assertTrue("swap recorded an AcquisitionLot for the received asset", swapLot !== null);

  const ethAccountId = await getUserAssetAccountId(swapUser.id, eth.id);
  const ethBalance = await prisma.ledgerAccountBalance.findUnique({ where: { ledgerAccountId: ethAccountId } });
  assertTrue("swap user's ETH balance fully drained", ethBalance?.balance.toString() === "0");

  // --- Cashout: stablecoin USDT (no WHT), full posting set incl. bank payout -------
  const cashoutUser = await prisma.user.create({ data: { email: `${testTag}-cashout@test.local` } });
  await fund(cashoutUser.id, usdt.id, (1000n * 10n ** 6n).toString()); // 1000 USDT
  await prisma.cashoutProfile.create({
    data: { userId: cashoutUser.id, firstName: "Test", lastName: "User", verifiedAt: new Date(), completedAt: new Date() },
  });
  const bankAccount = await prisma.cashoutBankAccount.create({
    data: { userId: cashoutUser.id, bankName: "Test Bank", accountNumber: "0000000000", isDefault: true },
  });

  const cashoutRequest = await executeTaxedCashout({
    userId: cashoutUser.id,
    sourceAssetId: usdt.id,
    ngnAmount: "50000",
    bankAccountId: bankAccount.id,
  });
  testRefIds.push(cashoutRequest.taxTransactionId!);

  assertTrue("cashout WHT is 0 for stablecoin", cashoutRequest.whtTokenAmount.toString() === "0");
  assertTrue("cashout fee > 0", cashoutRequest.feeNgnAmount.gt(0));
  assertTrue("cashout VAT > 0", cashoutRequest.vatNgnAmount.gt(0));
  assertTrue("cashout stamp duty is ₦50", cashoutRequest.stampNgnAmount.toString() === "50");
  assertTrue("cashout payout < gross ngnAmount (deductions applied)", cashoutRequest.payoutNgnAmount!.lt(cashoutRequest.ngnAmount));

  const cashoutPostings = await prisma.posting.findMany({
    where: { transactionId: cashoutRequest.taxTransactionId! },
    include: { fromAccount: true, toAccount: true },
  });
  assertTrue("cashout posted the full chain through to bank:payout", cashoutPostings.some((p) => p.toAccount.type === "BANK_PAYOUT"));
  assertTrue("cashout posted a leg into tax:STAMP", cashoutPostings.some((p) => p.toAccount.type === "TAX_STAMP"));
  assertTrue("cashout never touched tax:WHT (stablecoin)", !cashoutPostings.some((p) => p.toAccount.type === "TAX_WHT"));

  // --- Reversal: reject the cashout and confirm every leg mirrors back -----------
  const reversal = await reverseTaxTransaction(cashoutRequest.taxTransactionId!, "system-seed");
  testRefIds.push(reversal.id);
  const usdtAccountId = await getUserAssetAccountId(cashoutUser.id, usdt.id);
  const usdtBalanceAfterReversal = await prisma.ledgerAccountBalance.findUnique({ where: { ledgerAccountId: usdtAccountId } });
  assertTrue(
    "reversal restored the cashout user's USDT balance to the pre-cashout amount",
    usdtBalanceAfterReversal?.balance.toString() === (1000n * 10n ** 6n).toString(),
  );

  // --- Bill payment: non-stablecoin ETH, WHT grossed up, no stamp duty ------------
  const billUser = await prisma.user.create({ data: { email: `${testTag}-bill@test.local` } });
  await fund(billUser.id, eth.id, (10n ** 17n).toString()); // 0.1 ETH — plenty for a ₦5,000 bill

  const billRequest = await executeTaxedBillPayment({
    userId: billUser.id,
    billAmountNgn: "5000",
    assetSymbol: "ETH",
    billerCategory: "electricity",
    billerRef: "METER-12345",
  });
  testRefIds.push(billRequest.taxTransactionId!);

  assertTrue("bill WHT > 0 for non-stablecoin", billRequest.whtTokenAmount.gt(0));
  assertTrue("bill fee > 0", billRequest.feeNgnAmount.gt(0));
  assertTrue("bill VAT > 0", billRequest.vatNgnAmount.gt(0));

  const billPostings = await prisma.posting.findMany({
    where: { transactionId: billRequest.taxTransactionId! },
    include: { fromAccount: true, toAccount: true },
  });
  assertTrue("bill posted a leg into tax:WHT", billPostings.some((p) => p.toAccount.type === "TAX_WHT"));
  assertTrue("bill posted the full chain through to biller:settlement", billPostings.some((p) => p.toAccount.type === "BILLER_SETTLEMENT"));
  assertTrue("bill never touched tax:STAMP (not in the applicability matrix)", !billPostings.some((p) => p.toAccount.type === "TAX_STAMP"));

  // Load-bearing invariant from the brief: the token sold must be worth at least what
  // was needed (bill + fee + VAT) — re-verify independently of computeBillBreakdown's
  // own internal assertion, using the same price/rate this run actually captured.
  const billTaxEvent = await prisma.taxEvent.findFirstOrThrow({ where: { transactionId: billRequest.taxTransactionId! } });
  const priceSnapshotForBill = await prisma.priceSnapshot.findUniqueOrThrow({ where: { id: billTaxEvent.priceSnapshotId } });
  const soldValueNgnKobo =
    (BigInt(billRequest.soldTokenAmount.toString()) * BigInt(priceSnapshotForBill.usdPrice.mul(priceSnapshotForBill.usdNgnRate).mul(100).toFixed(0))) /
    10n ** 18n;
  const nairaNeededKobo = BigInt(billRequest.billAmountNgn.plus(billRequest.feeNgnAmount).plus(billRequest.vatNgnAmount).mul(100).toFixed(0));
  assertTrue(
    `bill gross-up invariant holds (sold value ${soldValueNgnKobo} kobo >= naira needed ${nairaNeededKobo} kobo)`,
    soldValueNgnKobo >= nairaNeededKobo - 1n,
  );

  // --- Universal double-entry invariant, scoped to exactly what this test posted --
  // (refIds are either an exact fund refId, or "<txId>:<legIndex>" for posted legs —
  // match by exact value or by prefix.)
  const allEntries = await prisma.ledgerAccountEntry.findMany({ select: { refId: true, direction: true, amount: true } });
  const relevant = allEntries.filter((e) => testRefIds.some((id) => e.refId === id || e.refId.startsWith(`${id}:`)));
  let totalCredits = 0n;
  let totalDebits = 0n;
  for (const e of relevant) {
    if (e.direction === "CREDIT") totalCredits += BigInt(e.amount.toString());
    else totalDebits += BigInt(e.amount.toString());
  }
  assertTrue(`double-entry invariant holds for this test's own activity (credits=${totalCredits}, debits=${totalDebits})`, totalCredits === totalDebits);

  // --- Cleanup ---------------------------------------------------------------------
  const testUserIds = [swapUser.id, cashoutUser.id, billUser.id];
  const cleanupAccounts = await prisma.ledgerAccount.findMany({ where: { userId: { in: testUserIds } } });
  const cleanupAccountIds = cleanupAccounts.map((a) => a.id);
  await prisma.taxEvent.deleteMany({ where: { userId: { in: testUserIds } } });
  await prisma.acquisitionLot.deleteMany({ where: { userId: { in: testUserIds } } });
  await prisma.cashoutBankAccount.deleteMany({ where: { userId: { in: testUserIds } } });
  await prisma.cashoutProfile.deleteMany({ where: { userId: { in: testUserIds } } });
  await prisma.cashoutRequest.deleteMany({ where: { userId: { in: testUserIds } } });
  await prisma.billPaymentRequest.deleteMany({ where: { userId: { in: testUserIds } } });
  await prisma.trade.deleteMany({ where: { userAId: { in: testUserIds } } });
  const txIds = (await prisma.taxTransaction.findMany({ where: { userId: { in: testUserIds } } })).map((t) => t.id);
  await prisma.posting.deleteMany({
    where: { OR: [{ transactionId: { in: txIds } }, { fromAccountId: { in: cleanupAccountIds } }, { toAccountId: { in: cleanupAccountIds } }] },
  });
  await prisma.taxTransaction.deleteMany({ where: { OR: [{ userId: { in: testUserIds } }, { id: reversal.id }] } });
  await prisma.taxQuote.deleteMany({ where: { userId: { in: testUserIds } } });
  await prisma.ledgerAccountEntry.deleteMany({ where: { ledgerAccountId: { in: cleanupAccountIds } } });
  await prisma.ledgerAccountBalance.deleteMany({ where: { ledgerAccountId: { in: cleanupAccountIds } } });
  await prisma.ledgerAccount.deleteMany({ where: { id: { in: cleanupAccountIds } } });
  await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });

  if (failures > 0) {
    console.error(`\n${failures} TAX EXECUTION ASSERTION(S) FAILED`);
    process.exit(1);
  }
  console.log("\nALL TAX EXECUTION ASSERTIONS PASSED");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
