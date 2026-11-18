import type { FastifyInstance } from "fastify";
import { requireAdmin, requireOwnerAdmin } from "../admin/require-admin.js";
import { getAddressPoolStatus, lookupPoolAddress } from "./address.service.js";

export async function adminAddressRoutes(app: FastifyInstance) {
  app.get(
    "/admin/address-pool/status",
    {
      preHandler: [requireAdmin, requireOwnerAdmin],
      schema: {
        tags: ["admin"],
        summary:
          "Pool inventory vs allotted-to-user counts per pool-based chain (solana) — confirms every imported address is tracked and none was double-assigned",
        security: [{ bearerAuth: [] }],
      },
    },
    async (_req, reply) => {
      const rows = await getAddressPoolStatus();
      return reply.send({ rows });
    },
  );

  app.get(
    "/admin/address-pool/lookup",
    {
      preHandler: [requireAdmin, requireOwnerAdmin],
      schema: {
        tags: ["admin"],
        summary: "Look up one address: is it in the pool, claimed, and which user actually has it",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: { address: { type: "string" } },
          required: ["address"],
        },
      },
    },
    async (req, reply) => {
      const { address } = req.query as { address: string };
      const result = await lookupPoolAddress(address);
      return reply.send(result);
    },
  );
}
