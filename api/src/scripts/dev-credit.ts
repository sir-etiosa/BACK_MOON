import { prisma } from "../db/prisma.js";
import { credit } from "../ledger/ledger.service.js";

// Dev-only helper to credit a user's ledger balance before chain watchers exist.
// Usage: npm run dev-credit -- user@example.com BTC 500000
async function main() {
  const [email, symbol, amount] = process.argv.slice(2);
  if (!email || !symbol || !amount) {
    throw new Error("Usage: npm run dev-credit -- email SYMBOL amountInSmallestUnits");
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } });
  const asset = await prisma.asset.findFirstOrThrow({ where: { symbol } });

  await credit({
    userId: user.id,
    assetId: asset.id,
    amount,
    refType: "ADJUSTMENT",
    refId: `dev-credit-${Date.now()}`,
  });
  console.log(`Credited ${amount} (smallest units) of ${symbol} to ${email}`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
