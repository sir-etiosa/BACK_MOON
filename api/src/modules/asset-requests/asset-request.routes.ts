import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/require-auth.js";
import { requireAdmin } from "../admin/require-admin.js";
import { requestAsset, getAllAssetRequests } from "./asset-request.service.js";

const requestSchema = z.object({
  tokenName: z.string().trim().min(1).max(100),
  network: z.string().trim().min(1).max(100),
});

export async function assetRequestRoutes(app: FastifyInstance) {
  app.post(
    "/asset-requests",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["asset-requests"],
        summary: "Ask us to list a token/network — capped at 10 per user per rolling week",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["tokenName", "network"],
          properties: {
            tokenName: { type: "string" },
            network: { type: "string" },
          },
        },
        response: {
          200: { type: "object", properties: { ok: { type: "boolean" } } },
          "4xx": { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const { tokenName, network } = requestSchema.parse(req.body);
      try {
        await requestAsset(req.userId!, tokenName, network);
        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(429).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/admin/asset-requests",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "List all user token/network requests",
        security: [{ bearerAuth: [] }],
      },
    },
    async () => {
      const requests = await getAllAssetRequests();
      return { requests };
    },
  );
}
