import fs from "node:fs";
import { prisma } from "../db/prisma.js";

// Bulk-imports a batch of pre-generated addresses into the pool for a pool-based chain
// (solana, monero). One address per line in the input file, blank lines ignored.
// Usage: npm run import-pool -- monero path/to/addresses.txt
async function main() {
  const [chain, filePath] = process.argv.slice(2);
  if (!chain || !filePath) {
    throw new Error("Usage: npm run import-pool -- <chain> <path-to-addresses-file>");
  }

  const lines = fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) throw new Error("No addresses found in that file");

  let inserted = 0;
  let skipped = 0;
  for (const address of lines) {
    try {
      await prisma.addressPool.create({ data: { chain, address } });
      inserted++;
    } catch (err) {
      // Unique constraint on address — already in the pool, safe to skip.
      skipped++;
    }
  }

  console.log(`Imported ${inserted} ${chain} addresses into the pool (${skipped} already present).`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
