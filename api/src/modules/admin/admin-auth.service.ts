import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";

const ADMIN_TOKEN_TTL = "12h";

export async function loginAdmin(email: string, password: string): Promise<string> {
  const admin = await prisma.adminUser.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!admin) throw new Error("Invalid email or password");

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) throw new Error("Invalid email or password");

  return jwt.sign({ adminId: admin.id, role: admin.role }, env.APP_JWT_SECRET, {
    expiresIn: ADMIN_TOKEN_TTL,
  });
}

export function verifyAdminToken(token: string): { adminId: string; role: string } {
  const payload = jwt.verify(token, env.APP_JWT_SECRET) as jwt.JwtPayload;
  return { adminId: payload.adminId as string, role: payload.role as string };
}
