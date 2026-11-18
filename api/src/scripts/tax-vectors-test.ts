import { computeSwapBreakdown, computeCashoutBreakdown, computeBillBreakdown, type FeeRuleLike } from "../modules/tax/calculations.js";

// Fixed assumptions from the brief's §5 test vectors: ETH=$3000, USD/NGN=1500,
// USDT=$1, fee=1%, VAT=7.5%, stamp duty=₦50. No DB — pure arithmetic against the
// calculation layer, run via `npm run test:tax-vectors`.

const WHT_RATE_BPS = 100;
const VAT_RATE_BPS = 750;
const STAMP_FLAT_KOBO = 5000n; // ₦50

let failures = 0;

function toWhole(minor: bigint, decimals: number): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const s = abs.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals) || "0";
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return (neg ? "-" : "") + whole + (frac ? "." + frac : "");
}

function assertEqual(label: string, actual: string, expected: string) {
  if (actual !== expected) {
    failures++;
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
  } else {
    console.log(`ok   ${label}: ${actual}`);
  }
}

function assertTrue(label: string, condition: boolean) {
  if (!condition) {
    failures++;
    console.error(`FAIL ${label}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

// --- Vector A: Swap 0.1 ETH -> USDC, fee taken in ETH ---------------------------
{
  const swapFeeRule: FeeRuleLike = { type: "PERCENT", rateBps: 100, chargeIn: "SOURCE_TOKEN", base: "GROSS" };
  const result = computeSwapBreakdown({
    grossTokenMinor: (10n ** 17n).toString(), // 0.1 ETH
    whtRateBps: WHT_RATE_BPS,
    feeRule: swapFeeRule,
    vatRateBps: VAT_RATE_BPS,
    fromUsdPrice: 3000,
    toUsdPrice: 1,
    fromDecimals: 18,
    toDecimals: 6,
  });

  console.log("--- Vector A: Swap 0.1 ETH -> USDC ---");
  assertEqual("A.wht", toWhole(result.whtToken, 18), "0.001");
  assertEqual("A.fee", toWhole(result.feeToken, 18), "0.001");
  assertEqual("A.vat", toWhole(result.vatToken, 18), "0.000075");
  assertEqual("A.net", toWhole(result.netToken, 18), "0.097925");
  assertEqual("A.proceeds", toWhole(result.proceeds, 6), "293.775");
}

// --- Vector B: Cash out 0.1 ETH, fee in naira ------------------------------------
{
  const cashoutFeeRule: FeeRuleLike = { type: "PERCENT", rateBps: 100, chargeIn: "NGN", base: "GROSS" };
  const result = computeCashoutBreakdown({
    grossTokenMinor: (10n ** 17n).toString(), // 0.1 ETH
    whtRateBps: WHT_RATE_BPS,
    feeRule: cashoutFeeRule,
    vatRateBps: VAT_RATE_BPS,
    stampFlatMinor: STAMP_FLAT_KOBO,
    tokenUsdPrice: 3000,
    usdNgnRate: 1500,
    tokenDecimals: 18,
  });

  console.log("--- Vector B: Cash out 0.1 ETH ---");
  assertEqual("B.wht", toWhole(result.whtToken, 18), "0.001");
  assertEqual("B.sold", toWhole(result.soldToken, 18), "0.099");
  assertEqual("B.proceedsNgn", toWhole(result.proceedsNgnKobo, 2), "445500");
  assertEqual("B.fee", toWhole(result.feeMinor, 2), "4500");
  assertEqual("B.vat", toWhole(result.vatMinor, 2), "337.5");
  assertEqual("B.stamp", toWhole(result.stampMinor, 2), "50");
  assertEqual("B.payout", toWhole(result.payoutNgnKobo, 2), "440612.5");
}

// --- Vector C: Cash out 100 USDT --------------------------------------------------
{
  const cashoutFeeRule: FeeRuleLike = { type: "PERCENT", rateBps: 100, chargeIn: "NGN", base: "GROSS" };
  const result = computeCashoutBreakdown({
    grossTokenMinor: (100n * 10n ** 6n).toString(), // 100 USDT
    whtRateBps: 0, // stablecoin — no WHT
    feeRule: cashoutFeeRule,
    vatRateBps: VAT_RATE_BPS,
    stampFlatMinor: STAMP_FLAT_KOBO,
    tokenUsdPrice: 1,
    usdNgnRate: 1500,
    tokenDecimals: 6,
  });

  console.log("--- Vector C: Cash out 100 USDT ---");
  assertEqual("C.wht", toWhole(result.whtToken, 6), "0");
  assertEqual("C.sold", toWhole(result.soldToken, 6), "100");
  assertEqual("C.proceedsNgn", toWhole(result.proceedsNgnKobo, 2), "150000");
  assertEqual("C.fee", toWhole(result.feeMinor, 2), "1500");
  assertEqual("C.vat", toWhole(result.vatMinor, 2), "112.5");
  assertEqual("C.stamp", toWhole(result.stampMinor, 2), "50");
  assertEqual("C.payout", toWhole(result.payoutNgnKobo, 2), "148337.5");
}

// --- Vector D: Pay ₦20,000 bill, fee 1%=₦200, VAT ₦15, no stamp -------------------
{
  const billFeeRule: FeeRuleLike = { type: "PERCENT", rateBps: 100, chargeIn: "NGN", base: "GROSS" };
  const billAmountNgnKobo = "2000000"; // ₦20,000

  console.log("--- Vector D: Pay ₦20,000 bill ---");

  // USDT path — stablecoin, no WHT, exact figures given in the brief.
  const usdtResult = computeBillBreakdown({
    billAmountNgnKobo,
    whtRateBps: 0,
    feeRule: billFeeRule,
    vatRateBps: VAT_RATE_BPS,
    tokenUsdPrice: 1,
    usdNgnRate: 1500,
    tokenDecimals: 6,
  });
  assertEqual("D.fee", toWhole(usdtResult.feeNgnKobo, 2), "200");
  assertEqual("D.vat", toWhole(usdtResult.vatNgnKobo, 2), "15");
  assertEqual("D.nairaNeeded", toWhole(usdtResult.nairaNeededKobo, 2), "20215");
  assertEqual("D.usdt.wht", toWhole(usdtResult.whtTokenMinor, 6), "0");
  assertEqual("D.usdt.charged", toWhole(usdtResult.grossTokenMinor, 6), "13.476667");
  assertEqual("D.usdt.sold", toWhole(usdtResult.soldTokenMinor, 6), "13.476667");

  // ETH path — non-stablecoin, WHT applies, gross-up required. The brief gives this
  // as an approximate figure (≈0.0045376 ETH) — assert the invariant (the load-bearing
  // check) and that the figure is in the right neighborhood, rather than exact equality.
  const ethResult = computeBillBreakdown({
    billAmountNgnKobo,
    whtRateBps: WHT_RATE_BPS,
    feeRule: billFeeRule,
    vatRateBps: VAT_RATE_BPS,
    tokenUsdPrice: 3000,
    usdNgnRate: 1500,
    tokenDecimals: 18,
  });
  assertTrue("D.eth.wht > 0", ethResult.whtTokenMinor > 0n);
  const ethChargedWhole = Number(toWhole(ethResult.grossTokenMinor, 18));
  assertTrue(
    `D.eth.charged ≈ 0.0045376 (got ${ethChargedWhole})`,
    Math.abs(ethChargedWhole - 0.0045376) < 0.0000005,
  );
  const ethSoldValueKobo =
    (ethResult.soldTokenMinor * 3000n * 1500n * 100n) / 10n ** 18n;
  assertTrue(
    `D.eth invariant: sold_token * price (${ethSoldValueKobo}) >= naira_needed (${ethResult.nairaNeededKobo})`,
    ethSoldValueKobo >= ethResult.nairaNeededKobo - 1n, // integer-division slack of at most 1 kobo
  );

  // BTC path — same logic as ETH, different price. No figure given in the brief;
  // just confirm the gross-up invariant holds (computeBillBreakdown throws if not).
  const btcResult = computeBillBreakdown({
    billAmountNgnKobo,
    whtRateBps: WHT_RATE_BPS,
    feeRule: billFeeRule,
    vatRateBps: VAT_RATE_BPS,
    tokenUsdPrice: 65_000,
    usdNgnRate: 1500,
    tokenDecimals: 8,
  });
  assertTrue("D.btc.wht > 0", btcResult.whtTokenMinor > 0n);
  const btcSoldValueKobo = (btcResult.soldTokenMinor * 65_000n * 1500n * 100n) / 10n ** 8n;
  assertTrue(
    `D.btc invariant: sold_token * price (${btcSoldValueKobo}) >= naira_needed (${btcResult.nairaNeededKobo})`,
    btcSoldValueKobo >= btcResult.nairaNeededKobo - 1n,
  );
}

if (failures > 0) {
  console.error(`\n${failures} TAX VECTOR ASSERTION(S) FAILED`);
  process.exit(1);
}
console.log("\nALL TAX VECTORS PASSED");
