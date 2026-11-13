import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../auth/require-auth.js";
import { getBalance } from "../../ledger/ledger.service.js";
import { getUsdPrices } from "../trade/price-feed.service.js";
import { getNgnRate } from "../admin/settings.service.js";
import { issueAllAddressesForUser } from "./address.service.js";

// Fixed display order across every balance list in the app — unlisted symbols sort last.
const ASSET_DISPLAY_ORDER = ["BTC", "ETH", "USDT", "USDC", "SOL", "XMR", "LTC"];

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
      const assets = (await prisma.asset.findMany({ where: { isActive: true } })).sort((a, b) => {
        const ai = ASSET_DISPLAY_ORDER.indexOf(a.symbol);
        const bi = ASSET_DISPLAY_ORDER.indexOf(b.symbol);
        return (ai === -1 ? ASSET_DISPLAY_ORDER.length : ai) - (bi === -1 ? ASSET_DISPLAY_ORDER.length : bi);
      });
      const [rawBalances, prices, ngnRate] = await Promise.all([
        Promise.all(assets.map((asset) => getBalance(req.userId!, asset.id))),
        getUsdPrices(assets.map((a) => a.symbol)),
        getNgnRate(),
      ]);

      const balances = assets.map((asset, i) => {
        const balance = rawBalances[i];
        const price = prices[asset.symbol];
        const whole = new Prisma.Decimal(balance).div(new Prisma.Decimal(10).pow(asset.decimals));
        return {
          id: asset.id,
          symbol: asset.symbol,
          chain: asset.chain,
          decimals: asset.decimals,
          balance: balance.toString(),
          usdValue: price ? whole.mul(price).toFixed(2) : null,
        };
      });
      return reply.send({ balances, ngnRate });
    },
  );
}
