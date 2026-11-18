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

/** Run after requireAdmin — restricts a route to the owner admin role. */
export async function requireOwnerAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (req.adminRole !== "owner") {
    return reply.code(403).send({ error: "Only the owner admin can do this" });
  }
}

/** Run after requireAdmin — restricts a route to the separately-scoped regulator
 * role. `AdminUser.role` is a plain string (not an enum), so this is just a new value
 * alongside "owner"/"operator" — zero migration risk. */
export async function requireRegulatorAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (req.adminRole !== "regulator") {
    return reply.code(403).send({ error: "Only a regulator account can do this" });
  }
}
