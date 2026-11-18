import { prisma } from "../db/prisma.js";

// Wipes every treasury account's ledger history, built up only from dev-credit/test-swap
// activity before any real deposit/withdrawal/swap ever happened. Safe only because
// nothing real has touched treasury yet. The house `User` concept is retired — treasury
// is now a `LedgerAccount` of type TREASURY per asset.
async function main() {
  const treasuryAccounts = await prisma.ledgerAccount.findMany({ where: { type: "TREASURY" } });
  const ids = treasuryAccounts.map((a) => a.id);
  await prisma.ledgerAccountEntry.deleteMany({ where: { ledgerAccountId: { in: ids } } });
  await prisma.ledgerAccountBalance.updateMany({ where: { ledgerAccountId: { in: ids } }, data: { balance: 0 } });
  console.log("Treasury account ledger/balances reset to zero.");
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
