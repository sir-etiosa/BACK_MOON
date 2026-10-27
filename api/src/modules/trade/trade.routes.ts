import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/require-auth.js";
import { swapAgainstHouse } from "./trade.service.js";
import { computeSwapQuote } from "./price-feed.service.js";
import { prisma } from "../../db/prisma.js";
import { InsufficientBalanceError } from "../../ledger/ledger.service.js";

const swapSchema = z.object({
  assetFromId: z.string().uuid(),
  amountFrom: z.string(),
  assetToId: z.string().uuid(),
});

export async function tradeRoutes(app: FastifyInstance) {
  app.post(
    "/trade/swap",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["trade"],
        summary: "Swap one asset for another against house inventory (rate computed server-side)",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["assetFromId", "amountFrom", "assetToId"],
          properties: {
            assetFromId: { type: "string", format: "uuid" },
            amountFrom: { type: "string", description: "Smallest units of assetFrom" },
            assetToId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (req, reply) => {
      const body = swapSchema.parse(req.body);

      const [assetFrom, assetTo] = await Promise.all([
        prisma.asset.findUniqueOrThrow({ where: { id: body.assetFromId } }),
        prisma.asset.findUniqueOrThrow({ where: { id: body.assetToId } }),
      ]);

      // The exchange rate is computed here, server-side, from a trusted price feed —
      // the client only ever names how much it wants to give, never the rate.
      const amountTo = await computeSwapQuote(assetFrom, assetTo, body.amountFrom);

      try {
        const trade = await swapAgainstHouse({
          userId: req.userId!,
          assetFromId: body.assetFromId,
          amountFrom: body.amountFrom,
          assetToId: body.assetToId,
          amountTo: amountTo.toString(),
        });
        return reply.send({ trade, amountTo: amountTo.toString() });
      } catch (err) {
        if (err instanceof InsufficientBalanceError) {
          return reply.code(400).send({ error: "Insufficient balance for this swap" });
        }
        throw err;
      }
    },
  );
}
