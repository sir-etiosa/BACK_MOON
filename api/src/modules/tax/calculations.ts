import { Prisma } from "@prisma/client";
import { roundUp, applyRateBps } from "./money.js";

type Amount = Prisma.Decimal | string | number | bigint;

function toDecimal(value: Amount): Prisma.Decimal {
  return new Prisma.Decimal(typeof value === "bigint" ? value.toString() : value);
}

/**
 * Pure, DB-free arithmetic for every tax/fee calculation in the module — callable
 * directly from tests with plain numbers (see scripts/tax-vectors-test.ts), and from
 * the real quote services with rule rows resolved from the DB. Every amount in and out
 * is an integer smallest-unit (minor) amount; the only rounding is `roundUp` (ceil) from
 * `money.ts`, applied at every derived tax/fee/gross-up step — raw user-submitted
 * amounts are never rounded.
 */

export interface FeeRuleLike {
  type: "PERCENT" | "FLAT";
  rateBps?: number | null;
  flatAmountMinor?: string | null;
  chargeIn: "SOURCE_TOKEN" | "FEE_CURRENCY" | "NGN";
  base: "GROSS" | "FEE" | "PER_TXN";
}

export function computeFeeMinor(rule: FeeRuleLike, baseAmountMinor: Amount): bigint {
  if (rule.type === "FLAT") return BigInt(rule.flatAmountMinor ?? "0");
  if (!rule.rateBps) return 0n;
  return applyRateBps(baseAmountMinor, rule.rateBps);
}

// ---------------------------------------------------------------------------------
// SWAP — brief §4.1: deduct WHT/fee/VAT from the gross token amount, then convert
// what's left at the quote price. v1's seeded SWAP fee rule always charges in the
// source token, which is the path this implements end to end.
// ---------------------------------------------------------------------------------

export interface SwapCalcInput {
  grossTokenMinor: Amount;
  whtRateBps: number;
  feeRule: FeeRuleLike | null;
  vatRateBps: number;
  fromUsdPrice: Prisma.Decimal | number;
  toUsdPrice: Prisma.Decimal | number;
  fromDecimals: number;
  toDecimals: number;
}

export interface SwapCalcResult {
  grossToken: bigint;
  whtToken: bigint;
  feeToken: bigint;
  vatToken: bigint;
  netToken: bigint;
  proceeds: bigint;
}

export function computeSwapBreakdown(input: SwapCalcInput): SwapCalcResult {
  const gross = toDecimal(input.grossTokenMinor);
  const whtToken = input.whtRateBps > 0 ? applyRateBps(gross, input.whtRateBps) : 0n;

  const feeToken = input.feeRule && input.feeRule.chargeIn !== "NGN" ? computeFeeMinor(input.feeRule, gross) : 0n;
  const vatToken = feeToken > 0n ? applyRateBps(feeToken.toString(), input.vatRateBps) : 0n;

  const netToken = gross.minus(whtToken.toString()).minus(feeToken.toString()).minus(vatToken.toString());
  if (netToken.lt(0)) throw new Error("Swap deductions exceed the amount submitted");

  const netWhole = netToken.div(new Prisma.Decimal(10).pow(input.fromDecimals));
  const usdValue = netWhole.mul(input.fromUsdPrice);
  const proceedsWhole = usdValue.div(input.toUsdPrice);
  const proceeds = BigInt(
    proceedsWhole.mul(new Prisma.Decimal(10).pow(input.toDecimals)).toDecimalPlaces(0).toFixed(0),
  );

  return {
    grossToken: BigInt(gross.toFixed(0)),
    whtToken,
    feeToken,
    vatToken,
    netToken: BigInt(netToken.toFixed(0)),
    proceeds,
  };
}

// ---------------------------------------------------------------------------------
// CASHOUT — brief §4.1: WHT comes off the gross token first; fee is computed against
// the GROSS naira-equivalent (not the post-WHT proceeds) per the seeded fee rule's
// `base: GROSS`; VAT on the fee; stamp duty flat, cashout-only.
// ---------------------------------------------------------------------------------

export interface CashoutCalcInput {
  grossTokenMinor: Amount;
  whtRateBps: number;
  feeRule: FeeRuleLike | null;
  vatRateBps: number;
  stampFlatMinor: bigint;
  tokenUsdPrice: Prisma.Decimal | number;
  usdNgnRate: Prisma.Decimal | number;
  tokenDecimals: number;
}

export interface CashoutCalcResult {
  grossToken: bigint;
  whtToken: bigint;
  soldToken: bigint;
  proceedsNgnKobo: bigint;
  feeMinor: bigint;
  vatMinor: bigint;
  stampMinor: bigint;
  payoutNgnKobo: bigint;
}

function tokenMinorToNgnKobo(
  amountMinor: Amount,
  decimals: number,
  usdPrice: Prisma.Decimal | number,
  usdNgnRate: Prisma.Decimal | number,
): Prisma.Decimal {
  return toDecimal(amountMinor)
    .div(new Prisma.Decimal(10).pow(decimals))
    .mul(usdPrice)
    .mul(usdNgnRate)
    .mul(100); // naira -> kobo
}

export function computeCashoutBreakdown(input: CashoutCalcInput): CashoutCalcResult {
  const gross = toDecimal(input.grossTokenMinor);
  const whtToken = input.whtRateBps > 0 ? applyRateBps(gross, input.whtRateBps) : 0n;
  const soldToken = BigInt(gross.toFixed(0)) - whtToken;

  const grossNgnKobo = tokenMinorToNgnKobo(gross, input.tokenDecimals, input.tokenUsdPrice, input.usdNgnRate);
  const proceedsNgnKobo = tokenMinorToNgnKobo(
    soldToken.toString(),
    input.tokenDecimals,
    input.tokenUsdPrice,
    input.usdNgnRate,
  ).toDecimalPlaces(0);

  const feeBase = input.feeRule?.base === "GROSS" ? grossNgnKobo.toDecimalPlaces(0) : proceedsNgnKobo;
  const feeMinor = input.feeRule ? computeFeeMinor(input.feeRule, feeBase) : 0n;
  const vatMinor = feeMinor > 0n ? applyRateBps(feeMinor.toString(), input.vatRateBps) : 0n;
  const stampMinor = input.stampFlatMinor;

  const payoutNgnKobo = BigInt(proceedsNgnKobo.toFixed(0)) - feeMinor - vatMinor - stampMinor;
  if (payoutNgnKobo < 0n) throw new Error("Cashout deductions exceed proceeds");

  return {
    grossToken: BigInt(gross.toFixed(0)),
    whtToken,
    soldToken,
    proceedsNgnKobo: BigInt(proceedsNgnKobo.toFixed(0)),
    feeMinor,
    vatMinor,
    stampMinor,
    payoutNgnKobo,
  };
}

// ---------------------------------------------------------------------------------
// BILL_PAYMENT — brief §4.2: user specifies the naira bill amount, which must be paid
// in full. Gross-up so WHT doesn't leave the bill short. No stamp duty on bills.
// ---------------------------------------------------------------------------------

export interface BillCalcInput {
  billAmountNgnKobo: Amount;
  whtRateBps: number;
  feeRule: FeeRuleLike | null;
  vatRateBps: number;
  tokenUsdPrice: Prisma.Decimal | number;
  usdNgnRate: Prisma.Decimal | number;
  tokenDecimals: number;
}

export interface BillCalcResult {
  billAmountNgnKobo: bigint;
  feeNgnKobo: bigint;
  vatNgnKobo: bigint;
  nairaNeededKobo: bigint;
  grossTokenMinor: bigint;
  whtTokenMinor: bigint;
  soldTokenMinor: bigint;
}

export function computeBillBreakdown(input: BillCalcInput): BillCalcResult {
  const billAmount = toDecimal(input.billAmountNgnKobo);
  const feeNgnKobo = input.feeRule ? computeFeeMinor(input.feeRule, billAmount) : 0n;
  const vatNgnKobo = feeNgnKobo > 0n ? applyRateBps(feeNgnKobo.toString(), input.vatRateBps) : 0n;
  const nairaNeeded = billAmount.plus(feeNgnKobo.toString()).plus(vatNgnKobo.toString());

  const tokenPriceNgnKoboPerWhole = new Prisma.Decimal(input.tokenUsdPrice).mul(input.usdNgnRate).mul(100);
  const minorPerWhole = new Prisma.Decimal(10).pow(input.tokenDecimals);

  let grossTokenMinor: bigint;
  if (input.whtRateBps > 0) {
    const whtFraction = new Prisma.Decimal(input.whtRateBps).div(10_000);
    const grossNgnKobo = nairaNeeded.div(new Prisma.Decimal(1).minus(whtFraction));
    grossTokenMinor = roundUp(grossNgnKobo.mul(minorPerWhole).div(tokenPriceNgnKoboPerWhole));
  } else {
    grossTokenMinor = roundUp(nairaNeeded.mul(minorPerWhole).div(tokenPriceNgnKoboPerWhole));
  }

  // Rounding WHT *up* off an already bare-minimum gross_token can shave sold_token's
  // value below naira_needed by a few kobo — worse the coarser the token's decimals
  // are relative to its price (BTC's 8dp felt this; ETH's 18dp mostly didn't). Rather
  // than accept an under-covered bill, grow gross_token one minor unit at a time until
  // the invariant genuinely holds — each step adds a whole token-price's worth of kobo
  // margin, so this converges in at most a handful of iterations.
  let whtTokenMinor = applyRateBps(grossTokenMinor.toString(), input.whtRateBps);
  let soldTokenMinor = grossTokenMinor - whtTokenMinor;
  let soldValueNgnKobo = new Prisma.Decimal(soldTokenMinor.toString())
    .div(minorPerWhole)
    .mul(tokenPriceNgnKoboPerWhole)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

  let guard = 0;
  while (soldValueNgnKobo.lt(nairaNeeded)) {
    if (++guard > 10_000) {
      throw new Error("Bill gross-up invariant violated: could not converge on a sufficient gross amount");
    }
    grossTokenMinor += 1n;
    whtTokenMinor = applyRateBps(grossTokenMinor.toString(), input.whtRateBps);
    soldTokenMinor = grossTokenMinor - whtTokenMinor;
    soldValueNgnKobo = new Prisma.Decimal(soldTokenMinor.toString())
      .div(minorPerWhole)
      .mul(tokenPriceNgnKoboPerWhole)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  }

  return {
    billAmountNgnKobo: BigInt(billAmount.toFixed(0)),
    feeNgnKobo,
    vatNgnKobo,
    nairaNeededKobo: BigInt(nairaNeeded.toFixed(0)),
    grossTokenMinor,
    whtTokenMinor,
    soldTokenMinor,
  };
}
