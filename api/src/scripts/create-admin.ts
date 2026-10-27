import bcrypt from "bcryptjs";
import { prisma } from "../db/prisma.js";

// Usage: npm run create-admin -- admin@example.com "a-strong-password"
async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    throw new Error('Usage: npm run create-admin -- "email" "password"');
  }
  if (password.length < 12) {
    throw new Error("Use a longer password — this account can approve real withdrawals");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.adminUser.upsert({
    where: { email: email.trim().toLowerCase() },
    create: { email: email.trim().toLowerCase(), passwordHash },
    update: { passwordHash },
  });
  console.log(`Admin ready: ${admin.email} (${admin.id})`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
