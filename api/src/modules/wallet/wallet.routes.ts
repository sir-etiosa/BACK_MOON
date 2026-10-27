import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../auth/require-auth.js";
import { getBalance } from "../../ledger/ledger.service.js";
import { issueAllAddressesForUser } from "./address.service.js";

export async function walletRoutes(app: FastifyInstance) {
  app.get(
    "/wallet/addresses",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["wallet"],
        summary: "Issue (if missing) and return this user's deposit address per chain",
        security: [{ bearerAuth: [] }],
      },
    },
    async (req, reply) => {
      const results = await issueAllAddressesForUser(req.userId!);
      return reply.send({ addresses: results });
    },
  );

  app.get(
    "/wallet/balances",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["wallet"],
        summary: "This user's ledger balance per asset",
        security: [{ bearerAuth: [] }],
      },
    },
    async (req, reply) => {
      const assets = await prisma.asset.findMany({ where: { isActive: true } });
      const balances = await Promise.all(
        assets.map(async (asset) => ({
          symbol: asset.symbol,
          chain: asset.chain,
          balance: (await getBalance(req.userId!, asset.id)).toString(),
        })),
      );
      return reply.send({ balances });
    },
  );
}
