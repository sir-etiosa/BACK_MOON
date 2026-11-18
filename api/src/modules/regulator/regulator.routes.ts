import type { FastifyInstance } from "fastify";
import { requireAdmin, requireRegulatorAdmin } from "../admin/require-admin.js";
import { prisma } from "../../db/prisma.js";
import { listRemittances } from "../tax/remittance.service.js";
import { getLatestReconciliation } from "../tax/reconciliation.service.js";
import { listSweeps } from "../tax/sweep.service.js";

/** Read-only, separately-scoped regulator view — live proof that tax is collected,
 * segregated, and remitted. The demo surface for NRS/CBN/NIBSS and bank partners. */
export async function regulatorRoutes(app: FastifyInstance) {
  app.get(
    "/regulator/summary",
    {
      preHandler: [requireAdmin, requireRegulatorAdmin],
      schema: {
        tags: ["regulator"],
        summary: "Totals collected / swept / remitted per tax type x asset within a date range",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: { from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" } },
        },
      },
    },
    async (req, reply) => {
      const { from, to } = req.query as { from?: string; to?: string };
      const dateFilter =
        from || to ? { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } : undefined;

      const events = await prisma.taxEvent.findMany({ where: dateFilter ? { createdAt: dateFilter } : {} });
      const collected = new Map<string, { whtTokenMinor: bigint; feeMinor: bigint; vatMinor: bigint; stampMinor: bigint }>();
      for (const e of events) {
        const key = e.assetSymbol;
        const current = collected.get(key) ?? { whtTokenMinor: 0n, feeMinor: 0n, vatMinor: 0n, stampMinor: 0n };
        current.whtTokenMinor += BigInt(e.whtTokenMinor.toString());
        current.feeMinor += BigInt(e.feeAmountMinor.toString());
        current.vatMinor += BigInt(e.vatAmountMinor.toString());
        current.stampMinor += BigInt(e.stampAmountKobo.toString());
        collected.set(key, current);
      }

      const sweeps = await prisma.taxSweep.findMany({
        where: { status: "COMPLETED", ...(dateFilter ? { createdAt: dateFilter } : {}) },
        include: { asset: { select: { symbol: true, chain: true } } },
      });
      const remittances = await prisma.taxRemittance.findMany({
        where: { status: "PAID", ...(dateFilter ? { createdAt: dateFilter } : {}) },
        include: { asset: { select: { symbol: true, chain: true } } },
      });

      return reply.send({
        collected: Object.fromEntries([...collected].map(([k, v]) => [k, { whtTokenMinor: v.whtTokenMinor.toString(), feeMinor: v.feeMinor.toString(), vatMinor: v.vatMinor.toString(), stampMinor: v.stampMinor.toString() }])),
        swept: sweeps.map((s) => ({ asset: `${s.asset.symbol}/${s.asset.chain}`, taxType: s.taxType, amountMinor: s.amountMinor.toString(), createdAt: s.createdAt })),
        remitted: remittances.map((r) => ({ asset: `${r.asset.symbol}/${r.asset.chain}`, taxType: r.taxType, amountMinor: r.amountMinor.toString(), nrsReceiptRef: r.nrsReceiptRef, createdAt: r.createdAt })),
      });
    },
  );

  app.get(
    "/regulator/remittances",
    { preHandler: [requireAdmin, requireRegulatorAdmin], schema: { tags: ["regulator"], summary: "Every remittance ever recorded", security: [{ bearerAuth: [] }] } },
    async (_req, reply) => reply.send({ remittances: await listRemittances() }),
  );

  app.get(
    "/regulator/sweeps",
    { preHandler: [requireAdmin, requireRegulatorAdmin], schema: { tags: ["regulator"], summary: "Every sweep ever recorded", security: [{ bearerAuth: [] }] } },
    async (_req, reply) => reply.send({ sweeps: await listSweeps() }),
  );

  app.get(
    "/regulator/reconciliation",
    { preHandler: [requireAdmin, requireRegulatorAdmin], schema: { tags: ["regulator"], summary: "Latest reconciliation run", security: [{ bearerAuth: [] }] } },
    async (_req, reply) => reply.send({ run: await getLatestReconciliation() }),
  );
}
