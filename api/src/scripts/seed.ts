import { prisma } from "../db/prisma.js";
import { HOUSE_EMAIL } from "../ledger/house.js";

const assets = [
  { symbol: "BTC", chain: "bitcoin", decimals: 8 },
  { symbol: "LTC", chain: "litecoin", decimals: 8 },
  { symbol: "ETH", chain: "evm", decimals: 18 },
  { symbol: "SOL", chain: "solana", decimals: 9 },
  { symbol: "XMR", chain: "monero", decimals: 12 },
  { symbol: "USDT", chain: "tron", decimals: 6, contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
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

  console.log("Seeded assets, chain configs, and house account.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
