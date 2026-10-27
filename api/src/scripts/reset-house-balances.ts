import { prisma } from "../db/prisma.js";
import { getHouseUserId } from "../ledger/house.js";

// Wipes the house account's ledger history, built up only from dev-credit/test-swap
// activity before any real deposit/withdrawal/swap ever happened. Safe only because
// nothing real has touched the house account yet.
async function main() {
  const houseId = await getHouseUserId();
  await prisma.ledgerEntry.deleteMany({ where: { userId: houseId } });
  await prisma.balance.deleteMany({ where: { userId: houseId } });
  console.log("House account ledger/balances reset to zero.");
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
