import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyAccessToken } from "./session.service.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing bearer token" });
  }
  try {
    const { userId } = verifyAccessToken(header.slice("Bearer ".length));
    req.userId = userId;
  } catch {
    return reply.code(401).send({ error: "Invalid or expired token" });
  }
}
