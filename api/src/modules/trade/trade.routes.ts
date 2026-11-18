import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/require-auth.js";
import { executeTaxedSwap } from "../tax/swap.service.js";
import { InsufficientBalanceError } from "../../ledger/ledger.service.js";

const swapSchema = z.object({
  fromSymbol: z.string().min(1),
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
        summary: "Swap a symbol (combined across any chains it's held on) for an asset against treasury inventory — withholds WHT/fee/VAT per the active tax rules",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["fromSymbol", "amountFrom", "assetToId"],
          properties: {
            fromSymbol: { type: "string", description: "Symbol to swap from, e.g. ETH — combined across chains" },
            amountFrom: { type: "string", description: "Smallest units of fromSymbol (same decimals on every chain it's held on)" },
            assetToId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (req, reply) => {
      const body = swapSchema.parse(req.body);

      try {
        const { trade, breakdown } = await executeTaxedSwap({
          userId: req.userId!,
          fromSymbol: body.fromSymbol,
          amountFrom: body.amountFrom,
          assetToId: body.assetToId,
        });
        return reply.send({
          trade,
          amountTo: breakdown.proceeds.toString(),
          tax: {
            whtToken: breakdown.whtToken.toString(),
            feeToken: breakdown.feeToken.toString(),
            vatToken: breakdown.vatToken.toString(),
            netToken: breakdown.netToken.toString(),
          },
        });
      } catch (err) {
        if (err instanceof InsufficientBalanceError) {
          return reply.code(400).send({ error: "Insufficient balance for this swap" });
        }
        throw err;
      }
    },
  );
}
