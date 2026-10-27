import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyAdminToken } from "./admin-auth.service.js";

declare module "fastify" {
  interface FastifyRequest {
    adminId?: string;
    adminRole?: string;
  }
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing bearer token" });
  }
  try {
    const { adminId, role } = verifyAdminToken(header.slice("Bearer ".length));
    req.adminId = adminId;
    req.adminRole = role;
  } catch {
    return reply.code(401).send({ error: "Invalid or expired admin token" });
  }
}
