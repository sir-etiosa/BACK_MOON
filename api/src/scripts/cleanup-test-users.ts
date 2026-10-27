import { prisma } from "../db/prisma.js";

// Removes disposable verification accounts created while testing against the fake test
// xpub/mnemonic — their EVM addresses collide with world-famous public test addresses
// (huge real tx history), which made watcher testing produce misleading noise.
const TEST_EMAILS = ["addrtest@example.com", "addrtest2@example.com", "realkeytest@example.com", "finaltest@example.com"];

async function main() {
  const users = await prisma.user.findMany({ where: { email: { in: TEST_EMAILS } } });
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) {
    console.log("Nothing to clean up — no matching test users found.");
    return;
  }

  await prisma.ledgerEntry.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.balance.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.deposit.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.withdrawal.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.trade.deleteMany({
    where: { OR: [{ userAId: { in: userIds } }, { userBId: { in: userIds } }] },
  });
  await prisma.userAddress.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.authOtp.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  console.log(`Cleaned up ${userIds.length} test user(s): ${users.map((u) => u.email).join(", ")}`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
