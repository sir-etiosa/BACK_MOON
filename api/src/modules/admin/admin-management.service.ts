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
