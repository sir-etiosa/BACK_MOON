import { Prisma } from "@prisma/client";

const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  LTC: "litecoin",
  ETH: "ethereum",
  SOL: "solana",
  XMR: "monero",
  USDT: "tether",
};

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { price: number; fetchedAt: number }>();

const FX_CACHE_TTL_MS = 60 * 60 * 1000;
let fxCache: { rate: number; fetchedAt: number } | null = null;

/** USD → NGN, for display only (cash-out/Naira-equivalent UI) — never used in ledger math. */
export async function getUsdToNgnRate(): Promise<number | null> {
  if (fxCache && Date.now() - fxCache.fetchedAt < FX_CACHE_TTL_MS) return fxCache.rate;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!res.ok) throw new Error(`FX feed request failed: ${res.status}`);
    const body = (await res.json()) as { rates?: Record<string, number> };
    const rate = body.rates?.NGN;
    if (!rate) throw new Error("FX feed returned no NGN rate");
    fxCache = { rate, fetchedAt: Date.now() };
    return rate;
  } catch {
    return fxCache?.rate ?? null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAndCachePrices(symbols: string[]): Promise<void> {
  const ids = [...new Set(symbols.map((s) => COINGECKO_IDS[s]).filter(Boolean))];
  if (ids.length === 0) return;

  // One batched CoinGecko call for every symbol we need, instead of one call per symbol —
  // firing N parallel requests per page load was enough to trip their free-tier rate limit.
  // Vercel's shared outbound IPs still get rate-limited occasionally even batched, so retry once.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`);
      if (!res.ok) throw new Error(`Price feed request failed: ${res.status}`);
      const body = (await res.json()) as Record<string, { usd: number }>;

      for (const symbol of symbols) {
        const id = COINGECKO_IDS[symbol];
        const price = id ? body[id]?.usd : undefined;
        if (price) cache.set(symbol, { price, fetchedAt: Date.now() });
      }
      return;
    } catch (err) {
      lastErr = err;
      if (attempt === 0) await sleep(300);
    }
  }
  throw lastErr;
}

export async function getUsdPrice(symbol: string): Promise<number> {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.price;

  if (!COINGECKO_IDS[symbol]) throw new Error(`No price feed mapping for ${symbol}`);
  await fetchAndCachePrices([symbol]);

  const fresh = cache.get(symbol);
  if (!fresh) throw new Error(`Price feed returned no USD price for ${symbol}`);
  return fresh.price;
}

/** Batched lookup for multiple symbols in one request — null per symbol the feed couldn't price. */
export async function getUsdPrices(symbols: string[]): Promise<Record<string, number | null>> {
  const now = Date.now();
  const stale = symbols.filter((s) => {
    const cached = cache.get(s);
    return !cached || now - cached.fetchedAt >= CACHE_TTL_MS;
  });

  if (stale.length > 0) {
    try {
      await fetchAndCachePrices(stale);
    } catch {
      // Leave whatever's left in cache (possibly nothing) — callers treat missing as null.
    }
  }

  const result: Record<string, number | null> = {};
  for (const symbol of symbols) {
    result[symbol] = cache.get(symbol)?.price ?? null;
  }
  return result;
}

/**
 * Computes how much of `toAsset` a swap of `amountFromSmallestUnits` of `fromAsset` is worth,
 * using server-side USD prices — the client never gets to supply or influence the rate.
 */
export async function computeSwapQuote(
  fromAsset: { symbol: string; decimals: number },
  toAsset: { symbol: string; decimals: number },
  amountFromSmallestUnits: Prisma.Decimal | string | number,
): Promise<Prisma.Decimal> {
  const [fromPrice, toPrice] = await Promise.all([
    getUsdPrice(fromAsset.symbol),
    getUsdPrice(toAsset.symbol),
  ]);

  const amountFromWhole = new Prisma.Decimal(amountFromSmallestUnits).div(
    new Prisma.Decimal(10).pow(fromAsset.decimals),
  );
  const usdValue = amountFromWhole.mul(fromPrice);
  const amountToWhole = usdValue.div(toPrice);
  return amountToWhole.mul(new Prisma.Decimal(10).pow(toAsset.decimals)).toDecimalPlaces(0);
}
