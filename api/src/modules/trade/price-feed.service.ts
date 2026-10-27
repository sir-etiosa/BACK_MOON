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

async function getUsdPrice(symbol: string): Promise<number> {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.price;

  const id = COINGECKO_IDS[symbol];
  if (!id) throw new Error(`No price feed mapping for ${symbol}`);

  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
  if (!res.ok) throw new Error(`Price feed request failed: ${res.status}`);
  const body = (await res.json()) as Record<string, { usd: number }>;
  const price = body[id]?.usd;
  if (!price) throw new Error(`Price feed returned no USD price for ${symbol}`);

  cache.set(symbol, { price, fetchedAt: Date.now() });
  return price;
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
