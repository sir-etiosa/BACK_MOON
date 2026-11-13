import bcrypt from "bcryptjs";
import { prisma } from "../db/prisma.js";

// Usage: npm run create-admin -- admin@example.com "a-strong-password" [role]
// Bootstrap admins default to "owner" (full privileges, incl. setting the cash-out
// rate and creating sub-admins). Re-run with an explicit role to promote/demote
// an existing admin without touching their password.
async function main() {
  const [email, password, role] = process.argv.slice(2);
  if (!email || !password) {
    throw new Error('Usage: npm run create-admin -- "email" "password" [role]');
  }
  if (password.length < 12) {
    throw new Error("Use a longer password — this account can approve real withdrawals");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.adminUser.upsert({
    where: { email: email.trim().toLowerCase() },
    create: { email: email.trim().toLowerCase(), passwordHash, role: role ?? "owner" },
    update: { passwordHash, ...(role ? { role } : {}) },
  });
  console.log(`Admin ready: ${admin.email} (${admin.id}, role: ${admin.role})`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
