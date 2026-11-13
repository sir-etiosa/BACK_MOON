import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/require-auth.js";
import { swapSymbolAgainstHouse } from "./trade.service.js";
import { computeSwapQuote } from "./price-feed.service.js";
import { prisma } from "../../db/prisma.js";
import { getBalance, InsufficientBalanceError } from "../../ledger/ledger.service.js";

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
        summary: "Swap a symbol (combined across any chains it's held on) for an asset against house inventory",
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

      const [fromVariants, assetTo] = await Promise.all([
        prisma.asset.findMany({ where: { symbol: body.fromSymbol, isActive: true } }),
        prisma.asset.findUniqueOrThrow({ where: { id: body.assetToId } }),
      ]);
      if (fromVariants.length === 0) {
        return reply.code(400).send({ error: `Unknown asset ${body.fromSymbol}` });
      }

      // Drain the largest balance first so a small source doesn't dust out before it's needed.
      const withBalances = await Promise.all(
        fromVariants.map(async (asset) => ({ asset, balance: await getBalance(req.userId!, asset.id) })),
      );
      withBalances.sort((a, b) => (b.balance.gt(a.balance) ? 1 : b.balance.lt(a.balance) ? -1 : 0));

      let remaining = BigInt(body.amountFrom);
      const legs: { assetId: string; amount: string }[] = [];
      for (const { asset, balance } of withBalances) {
        if (remaining <= 0n) break;
        const available = BigInt(balance.toFixed(0));
        if (available <= 0n) continue;
        const take = available < remaining ? available : remaining;
        legs.push({ assetId: asset.id, amount: take.toString() });
        remaining -= take;
      }

      if (remaining > 0n) {
        return reply.code(400).send({ error: "Insufficient balance for this swap" });
      }

      // All chain-variants of a symbol share the same decimals — safe to quote once for the total.
      const amountTo = await computeSwapQuote(
        { symbol: body.fromSymbol, decimals: fromVariants[0].decimals },
        assetTo,
        body.amountFrom,
      );

      try {
        const trade = await swapSymbolAgainstHouse({
          userId: req.userId!,
          legs,
          amountFromTotal: body.amountFrom,
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
