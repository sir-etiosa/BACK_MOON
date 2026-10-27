import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

// Loads xpubs from env (.env) into chain_configs. Run this once per the seed runbook
// after the offline derivation script has produced the real account xpubs — or when
// swapping in a new xpub for any reason. Never put a private key/seed here.
const entries: { chain: string; xpub: string | undefined }[] = [
  { chain: "evm", xpub: env.EVM_XPUB },
  { chain: "tron", xpub: env.TRON_XPUB },
  { chain: "litecoin", xpub: env.LTC_XPUB },
  { chain: "bitcoin", xpub: env.BTC_XPUB },
];

async function main() {
  for (const { chain, xpub } of entries) {
    if (!xpub) {
      console.log(`Skipping ${chain}: no xpub set in .env`);
      continue;
    }
    await prisma.chainConfig.update({ where: { chain }, data: { xpub } });
    console.log(`Loaded xpub for ${chain}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
