import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { getUsdPrice } from "../trade/price-feed.service.js";
import { getNgnRate } from "../admin/settings.service.js";

/** XCH (user-facing "NGN") is pegged 1:1 to naira by definition — it's not traded on
 * any market, so there is no CoinGecko (or similar) price for it, and trying to fetch
 * one would just throw. Its "USD price" is derived so that usdPrice × usdNgnRate == 1
 * always, letting every existing price-based calculation (computeBillBreakdown,
 * computeCashoutBreakdown) work for it completely unchanged. */
const FIXED_PEG_SYMBOL = "XCH";

/**
 * Captures one price snapshot per quote: the token's USD price and the USD/NGN rate,
 * each tagged with its own source so either can be swapped out later without a schema
 * change (e.g. once the NRS publishes an approved aggregator list — see OPEN items).
 * Per the locked decision, the NGN rate comes from the existing admin-settable rate
 * (`getNgnRate()`) — it transparently falls back to the live FX feed until an owner
 * admin sets one explicitly, same as today's cashout/display pricing; never assume a
 * stablecoin is worth exactly $1, it goes through `getUsdPrice` like anything else —
 * except XCH, which is pegged by definition, not priced by a market (see above).
 */
export async function capturePriceSnapshot(assetId: string, symbol: string) {
  const usdNgnRate = await getNgnRate();
  if (!usdNgnRate) throw new Error("NGN rate is unavailable right now, try again shortly");

  const usdPrice =
    symbol === FIXED_PEG_SYMBOL ? new Prisma.Decimal(1).div(usdNgnRate) : await getUsdPrice(symbol);

  return prisma.priceSnapshot.create({
    data: {
      assetId,
      usdPrice,
      usdNgnRate,
      source: symbol === FIXED_PEG_SYMBOL ? "xch_fixed_peg" : "admin_manual",
    },
  });
}
