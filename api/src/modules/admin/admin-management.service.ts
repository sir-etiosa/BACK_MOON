import bcrypt from "bcryptjs";
import { prisma } from "../../db/prisma.js";

/** Owner-only: create a sub-admin. Sub-admins are always "operator" — only the
 * owner role is allowed to set rates or create other admins. */
export async function createSubAdmin(email: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.adminUser.create({
    data: { email: email.trim().toLowerCase(), passwordHash, role: "operator" },
    select: { id: true, email: true, role: true, createdAt: true },
  });
}

export async function listAdmins() {
  return prisma.adminUser.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, role: true, createdAt: true },
  });
}

/** Owner-only: remove an admin account. Guards against removing yourself or the
 * last remaining owner — either would leave the platform with no one able to
 * manage admins or set the cash-out rate. */
export async function deleteAdmin(adminId: string, requestingAdminId: string): Promise<void> {
  if (adminId === requestingAdminId) {
    throw new Error("You can't delete your own account");
  }

  const target = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!target) throw new Error("Admin not found");

  if (target.role === "owner") {
    const ownerCount = await prisma.adminUser.count({ where: { role: "owner" } });
    if (ownerCount <= 1) {
      throw new Error("Can't delete the last remaining owner account");
    }
  }

  await prisma.adminUser.delete({ where: { id: adminId } });
}
