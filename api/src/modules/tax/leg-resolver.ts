import type { Asset } from "@prisma/client";
import { getUserAssetBalance, InsufficientBalanceError } from "../../ledger/ledger.service.js";

export interface ResolvedLeg {
  asset: Asset;
  amount: bigint;
}

/**
 * Drains a user's balance across every chain-variant of a symbol, largest first, to
 * cover `amountNeeded` — extracted from the swap route so cashout and bill payment can
 * reuse the same multi-chain-balance logic swap already had. Throws
 * `InsufficientBalanceError` if the combined balance can't cover it.
 */
export async function resolveSymbolLegs(
  userId: string,
  variants: Asset[],
  amountNeeded: bigint | string,
): Promise<ResolvedLeg[]> {
  const withBalances = await Promise.all(
    variants.map(async (asset) => ({ asset, balance: await getUserAssetBalance(userId, asset.id) })),
  );
  withBalances.sort((a, b) => (b.balance.gt(a.balance) ? 1 : b.balance.lt(a.balance) ? -1 : 0));

  let remaining = typeof amountNeeded === "string" ? BigInt(amountNeeded) : amountNeeded;
  const legs: ResolvedLeg[] = [];
  for (const { asset, balance } of withBalances) {
    if (remaining <= 0n) break;
    const available = BigInt(balance.toFixed(0));
    if (available <= 0n) continue;
    const take = available < remaining ? available : remaining;
    legs.push({ asset, amount: take });
    remaining -= take;
  }

  if (remaining > 0n) {
    throw new InsufficientBalanceError(`${userId}:${variants[0]?.symbol ?? "unknown"}`);
  }
  return legs;
}

/**
 * Splits a set of total deductions (wht/fee/vat/net) proportionally across resolved
 * legs, largest leg first — each leg's share is drained from its own remaining amount
 * so the per-leg allocations always sum exactly to the totals (no rounding drift,
 * since every total is already an integer).
 */
export function allocateAcrossLegs(
  legs: ResolvedLeg[],
  totals: { whtToken: bigint; feeToken: bigint; vatToken: bigint; netToken: bigint },
): { asset: Asset; whtAlloc: bigint; feeAlloc: bigint; vatAlloc: bigint; netAlloc: bigint }[] {
  let whtRemaining = totals.whtToken;
  let feeRemaining = totals.feeToken;
  let vatRemaining = totals.vatToken;
  let netRemaining = totals.netToken;

  return legs.map((leg) => {
    let legRemaining = leg.amount;
    const take = (pool: bigint): bigint => {
      const amount = pool < legRemaining ? pool : legRemaining;
      legRemaining -= amount;
      return amount;
    };
    const whtAlloc = take(whtRemaining);
    whtRemaining -= whtAlloc;
    const feeAlloc = take(feeRemaining);
    feeRemaining -= feeAlloc;
    const vatAlloc = take(vatRemaining);
    vatRemaining -= vatAlloc;
    const netAlloc = take(netRemaining);
    netRemaining -= netAlloc;
    return { asset: leg.asset, whtAlloc, feeAlloc, vatAlloc, netAlloc };
  });
}
