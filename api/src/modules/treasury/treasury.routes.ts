import type { FastifyInstance } from "fastify";
import { requireAdmin, requireOwnerAdmin } from "../admin/require-admin.js";
import { getAssetExposureReport } from "./treasury.service.js";

export async function treasuryRoutes(app: FastifyInstance) {
  app.get(
    "/admin/treasury/exposure",
    {
      preHandler: [requireAdmin, requireOwnerAdmin],
      schema: {
        tags: ["admin"],
        summary: "On-chain custody vs ledger-owed per asset, and the gap that guides manual hedging",
        security: [{ bearerAuth: [] }],
      },
    },
    async (_req, reply) => {
      const rows = await getAssetExposureReport();
      return reply.send({ rows });
    },
  );
}
