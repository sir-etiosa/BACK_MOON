import { prisma } from "../db/prisma.js";
import { mintXch } from "../modules/tax/xch.service.js";
import { executeTaxedBillPayment } from "../modules/tax/bill.service.js";
import { executeTaxedCashout } from "../modules/tax/cashout.service.js";
import { executeTaxedSwap } from "../modules/tax/swap.service.js";
import { getUserAssetAccountId, getAccountBalance, getSystemAccountId, applyLedgerTransfer, TX_OPTIONS } from "../ledger/ledger.service.js";
import { setNgnRate } from "../modules/admin/settings.service.js";

/** Exercises the XCH (user-facing "NGN") token end to end: mint, pay a bill with it,
 * cash it out — none of which should ever charge WHT, and none of which should crash
 * on a missing price feed. Also confirms it's blocked from swap. Run via
 * `npm run test:tax-xch`. */

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
  const testTag = `tax-xch-test-${Date.now()}`;
  await setNgnRate(1500, "system-seed");

  const xch = await prisma.asset.findUniqueOrThrow({ where: { symbol_chain: { symbol: "XCH", chain: "fiat" } } });
  assertTrue("XCH is categorized STABLECOIN (WHT never applies to it)", xch.category === "STABLECOIN");

  // Treasury needs real NGN inventory to pay out against (same as every other asset).
  const treasuryXchId = await getSystemAccountId("TREASURY", xch.id);
  const externalXchId = await getSystemAccountId("EXTERNAL", xch.id);
  await prisma.$transaction(
    (tx) =>
      applyLedgerTransfer(tx, {
        fromAccountId: externalXchId,
        toAccountId: treasuryXchId,
        assetId: xch.id,
        amount: (10_000_000n * 100n).toString(),
        refType: "ADJUSTMENT",
        refId: `${testTag}-fund-treasury`,
      }),
    TX_OPTIONS,
  );

  const user = await prisma.user.create({ data: { email: `${testTag}@test.local` } });

  // --- Mint: simulates a confirmed bank deposit crediting the user's NGN wallet ---
  await mintXch(user.id, "10000000", `${testTag}-mint`); // ₦100,000
  const xchAccountId = await getUserAssetAccountId(user.id, xch.id);
  const balanceAfterMint = await getAccountBalance(xchAccountId);
  assertTrue("mint credited the user's XCH balance by exactly the minted amount", balanceAfterMint.toFixed(0) === "10000000");

  // --- Swap must be blocked ---------------------------------------------------------
  let swapBlocked = false;
  try {
    await executeTaxedSwap({ userId: user.id, fromSymbol: "XCH", amountFrom: "1000", assetToId: xch.id });
  } catch {
    swapBlocked = true;
  }
  assertTrue("swapping XCH is blocked", swapBlocked);

  // --- Pay a bill with XCH: no WHT, no price-feed crash, fee+VAT only -------------
  const billRequest = await executeTaxedBillPayment({
    userId: user.id,
    billAmountNgn: "5000",
    assetSymbol: "XCH",
    billerCategory: "electricity",
    billerRef: "METER-XCH-TEST",
  });
  assertTrue("XCH bill payment charges zero WHT", billRequest.whtTokenAmount.toString() === "0");
  assertTrue("XCH bill payment still charges fee", billRequest.feeNgnAmount.gt(0));
  assertTrue("XCH bill payment still charges VAT", billRequest.vatNgnAmount.gt(0));
  // 1 XCH == ₦1 exactly, so soldTokenAmount (in kobo) should equal fee+VAT+bill, in kobo.
  const expectedChargedKobo = billRequest.billAmountNgn
    .plus(billRequest.feeNgnAmount)
    .plus(billRequest.vatNgnAmount)
    .mul(100);
  assertTrue(
    `XCH charged exactly bill+fee+VAT at 1:1 (charged=${billRequest.soldTokenAmount}, expected=${expectedChargedKobo})`,
    billRequest.soldTokenAmount.eq(expectedChargedKobo),
  );

  // --- Cash out the remaining XCH to the bank: no WHT, fee+VAT+stamp --------------
  await prisma.cashoutProfile.create({
    data: { userId: user.id, firstName: "Xch", lastName: "Test", verifiedAt: new Date(), completedAt: new Date() },
  });
  const bankAccount = await prisma.cashoutBankAccount.create({
    data: { userId: user.id, bankName: "Test Bank", accountNumber: "1111111111", isDefault: true },
  });
  const cashoutRequest = await executeTaxedCashout({
    userId: user.id,
    sourceAssetId: xch.id,
    ngnAmount: "50000",
    bankAccountId: bankAccount.id,
  });
  assertTrue("XCH cashout charges zero WHT", cashoutRequest.whtTokenAmount.toString() === "0");
  assertTrue("XCH cashout still charges fee", cashoutRequest.feeNgnAmount.gt(0));
  assertTrue("XCH cashout still charges VAT", cashoutRequest.vatNgnAmount.gt(0));
  assertTrue("XCH cashout still charges ₦50 stamp duty", cashoutRequest.stampNgnAmount.toString() === "50");
  assertTrue(
    "XCH cashout payout is naira-exact (gross minus fee/VAT/stamp)",
    cashoutRequest.payoutNgnAmount!.eq(
      cashoutRequest.ngnAmount.minus(cashoutRequest.feeNgnAmount).minus(cashoutRequest.vatNgnAmount).minus(cashoutRequest.stampNgnAmount),
    ),
  );

  // --- Cleanup -----------------------------------------------------------------
  const accountIds = (await prisma.ledgerAccount.findMany({ where: { userId: user.id } })).map((a) => a.id);
  await prisma.taxEvent.deleteMany({ where: { userId: user.id } });
  await prisma.billPaymentRequest.deleteMany({ where: { userId: user.id } });
  await prisma.cashoutBankAccount.deleteMany({ where: { userId: user.id } });
  await prisma.cashoutProfile.deleteMany({ where: { userId: user.id } });
  await prisma.cashoutRequest.deleteMany({ where: { userId: user.id } });
  const txIds = (await prisma.taxTransaction.findMany({ where: { userId: user.id } })).map((t) => t.id);
  await prisma.posting.deleteMany({
    where: { OR: [{ transactionId: { in: txIds } }, { fromAccountId: { in: accountIds } }, { toAccountId: { in: accountIds } }] },
  });
  await prisma.taxTransaction.deleteMany({ where: { userId: user.id } });
  await prisma.taxQuote.deleteMany({ where: { userId: user.id } });
  await prisma.ledgerAccountEntry.deleteMany({
    where: { OR: [{ ledgerAccountId: { in: accountIds } }, { refId: { startsWith: testTag } }] },
  });
  await prisma.ledgerAccountBalance.deleteMany({ where: { ledgerAccountId: { in: accountIds } } });
  await prisma.ledgerAccount.deleteMany({ where: { id: { in: accountIds } } });
  await prisma.user.deleteMany({ where: { id: user.id } });
  await prisma.ledgerAccountBalance.update({
    where: { ledgerAccountId: treasuryXchId },
    data: { balance: { decrement: (10_000_000n * 100n).toString() } },
  });

  if (failures > 0) {
    console.error(`\n${failures} XCH ASSERTION(S) FAILED`);
    process.exit(1);
  }
  console.log("\nALL XCH ASSERTIONS PASSED");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
