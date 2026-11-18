import { prisma } from "../db/prisma.js";
import { HOUSE_EMAIL } from "../ledger/house.js";
import { createTaxRule, createFeeRule } from "../modules/tax/rules.service.js";

const assets = [
  { symbol: "BTC", chain: "bitcoin", decimals: 8, category: "NON_STABLE" as const },
  { symbol: "LTC", chain: "litecoin", decimals: 8, category: "NON_STABLE" as const },
  { symbol: "ETH", chain: "evm", decimals: 18, category: "NON_STABLE" as const },
  { symbol: "SOL", chain: "solana", decimals: 9, category: "NON_STABLE" as const },
  {
    symbol: "USDC",
    chain: "solana",
    decimals: 6,
    contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // official Circle USDC mint on Solana mainnet
    category: "STABLECOIN" as const,
  },
  { symbol: "XMR", chain: "monero", decimals: 12, category: "NON_STABLE" as const },
  {
    symbol: "USDT",
    chain: "tron",
    decimals: 6,
    contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    category: "STABLECOIN" as const,
  },
  {
    symbol: "USDC",
    chain: "evm",
    decimals: 6,
    contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    category: "STABLECOIN" as const,
  },
  // Base shares the same EVM address as mainnet (same xpub, same derivation) — these two rows
  // exist purely so the watcher and frontend can track/credit deposits on Base as distinct
  // assets, not because Base needs its own address derivation or chain_config.
  { symbol: "ETH", chain: "base", decimals: 18, category: "NON_STABLE" as const },
  {
    symbol: "USDC",
    chain: "base",
    decimals: 6,
    contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    category: "STABLECOIN" as const,
  },
  // Internal naira-pegged token (user-facing label "NGN") — no chain/address, minted
  // 1:1 when a user deposits naira. category: STABLECOIN so WHT never applies to it
  // (it's never a crypto disposal); not swappable yet. See modules/tax/pricing.service.ts
  // for how it's priced (fixed 1:1 peg, not a market lookup).
  { symbol: "XCH", chain: "fiat", decimals: 2, category: "STABLECOIN" as const },
];

const chainConfigs = [
  { chain: "evm", coinType: 60 },
  { chain: "tron", coinType: 195 },
  { chain: "litecoin", coinType: 2 },
  { chain: "bitcoin", coinType: 0 },
  { chain: "solana", coinType: 501 },
  { chain: "monero", coinType: null },
];

async function main() {
  for (const asset of assets) {
    await prisma.asset.upsert({
      where: { symbol_chain: { symbol: asset.symbol, chain: asset.chain } },
      create: asset,
      update: asset,
    });
  }

  for (const cfg of chainConfigs) {
    await prisma.chainConfig.upsert({
      where: { chain: cfg.chain },
      create: cfg,
      update: {},
    });
  }

  const house = await prisma.user.upsert({
    where: { email: HOUSE_EMAIL },
    create: { email: HOUSE_EMAIL, emailVerifiedAt: new Date(), status: "system" },
    update: {},
  });
  console.log(`House account: ${house.id}`);

  await seedTaxPolicy();

  console.log("Seeded assets, chain configs, house account, and v1 tax/fee rules.");
}

/** v1 tax policy from the build brief's applicability matrix (NRS Circular 2026/21).
 * Every figure here is config with an effective date, not a hardcoded constant — see
 * `modules/tax/rules.service.ts`. Rates must be confirmed with a Nigerian tax
 * practitioner before real enforcement; this is not tax advice. */
async function seedTaxPolicy() {
  const ngnAsset = await prisma.asset.findUniqueOrThrow({ where: { symbol_chain: { symbol: "XCH", chain: "fiat" } } });
  const EPOCH = new Date("2026-01-01T00:00:00Z");

  // WHT 1% on non-stablecoin disposals via swap/cashout/bill payment, collected in the
  // original token (ETH stays ETH). No WHT on stablecoins — no rule is seeded for
  // STABLECOIN, so lookups fall through to "no matching rule" = 0%.
  for (const eventType of ["SWAP", "CASHOUT", "BILL_PAYMENT"] as const) {
    await createTaxRule({
      taxType: "WHT",
      eventType,
      assetCategory: "NON_STABLE",
      rateBps: 100,
      base: "GROSS",
      collectIn: "SOURCE_TOKEN",
      effectiveFrom: EPOCH,
      createdByAdminId: "system-seed",
    });
  }

  // VAT 7.5% on MoonXch's fee only (never the transaction amount), charged on top, in
  // the same currency as the fee. Applies regardless of stablecoin/non-stablecoin —
  // assetCategory is left null so one rule covers both.
  for (const eventType of ["SWAP", "CASHOUT", "BILL_PAYMENT"] as const) {
    await createTaxRule({
      taxType: "VAT",
      eventType,
      assetCategory: null,
      rateBps: 750,
      base: "FEE",
      collectIn: "FEE_CURRENCY",
      effectiveFrom: EPOCH,
      createdByAdminId: "system-seed",
    });
  }

  // Stamp duty: MoonXch's policy deviation from the circular's 1.5%-in-token — flat
  // ₦50, naira, cash-outs to bank only (not swaps, not bill payments). `thresholdMinor`
  // is deliberately left unset (OPEN item: PwC's proposed ₦10,000 threshold). Switching
  // to the circular's literal rate later is a new rule version, zero code changes.
  await createTaxRule({
    taxType: "STAMP",
    eventType: "CASHOUT",
    assetCategory: null,
    flatAmountMinor: "5000", // ₦50 in kobo
    flatCurrencyAssetId: ngnAsset.id,
    base: "PER_TXN",
    collectIn: "NGN",
    effectiveFrom: EPOCH,
    createdByAdminId: "system-seed",
  });

  // MoonXch fee: 1% of gross, charged in the source token for swaps, in naira for
  // cash-outs and bill payments — configurable per event type (flat or percentage,
  // token or naira). If the fee is 0, VAT on it is 0.
  await createFeeRule({
    eventType: "SWAP",
    assetId: null,
    type: "PERCENT",
    rateBps: 100,
    chargeIn: "SOURCE_TOKEN",
    base: "GROSS",
    effectiveFrom: EPOCH,
    createdByAdminId: "system-seed",
  });
  await createFeeRule({
    eventType: "CASHOUT",
    assetId: null,
    type: "PERCENT",
    rateBps: 100,
    chargeIn: "NGN",
    base: "GROSS",
    effectiveFrom: EPOCH,
    createdByAdminId: "system-seed",
  });
  await createFeeRule({
    eventType: "BILL_PAYMENT",
    assetId: null,
    type: "PERCENT",
    rateBps: 100,
    chargeIn: "NGN",
    base: "GROSS",
    effectiveFrom: EPOCH,
    createdByAdminId: "system-seed",
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
