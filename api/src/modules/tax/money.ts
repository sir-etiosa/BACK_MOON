import { Prisma } from "@prisma/client";

// Default decimal.js precision (20 significant digits) isn't enough once a repeating
// division (e.g. the bill gross-up's 1/(1-wht_rate)) compounds with 18dp ETH-level
// precision. Raised once, process-wide, since nothing else in the app needs tight
// precision bounds.
Prisma.Decimal.set({ precision: 50 });

/**
 * The only rounding function in the tax module — tax amounts round UP so the
 * platform never under-withholds. Raw user-submitted amounts are never rounded;
 * only values derived from a rate/percentage calculation go through this.
 */
export function roundUp(value: Prisma.Decimal | string | number | bigint): bigint {
  return BigInt(new Prisma.Decimal(typeof value === "bigint" ? value.toString() : value).ceil().toFixed(0));
}

/** rateBps is basis points (1% = 100 bps, 7.5% = 750 bps). */
export function applyRateBps(amount: Prisma.Decimal | string | number | bigint, rateBps: number): bigint {
  const decimal = typeof amount === "bigint" ? amount.toString() : amount;
  return roundUp(new Prisma.Decimal(decimal).mul(rateBps).div(10_000));
}
