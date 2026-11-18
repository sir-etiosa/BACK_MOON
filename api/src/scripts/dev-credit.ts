import { prisma } from "../db/prisma.js";
import { applyLedgerTransfer, getSystemAccountId, getUserAssetAccountId, TX_OPTIONS } from "../ledger/ledger.service.js";

// Dev-only helper to credit a user's ledger balance before chain watchers exist.
// Usage: npm run dev-credit -- user@example.com BTC 500000
async function main() {
  const [email, symbol, amount] = process.argv.slice(2);
  if (!email || !symbol || !amount) {
    throw new Error("Usage: npm run dev-credit -- email SYMBOL amountInSmallestUnits");
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } });
  const asset = await prisma.asset.findFirstOrThrow({ where: { symbol } });

  const userAccountId = await getUserAssetAccountId(user.id, asset.id);
  const externalAccountId = await getSystemAccountId("EXTERNAL", asset.id);

  await prisma.$transaction(
    (tx) =>
      applyLedgerTransfer(tx, {
        fromAccountId: externalAccountId,
        toAccountId: userAccountId,
        assetId: asset.id,
        amount,
        refType: "ADJUSTMENT",
        refId: `dev-credit-${Date.now()}`,
      }),
    TX_OPTIONS,
  );
  console.log(`Credited ${amount} (smallest units) of ${symbol} to ${email}`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
