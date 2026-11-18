import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireOwnerAdmin } from "../admin/require-admin.js";
import { prisma } from "../../db/prisma.js";
import { getAccountBalance, getSystemAccountId } from "../../ledger/ledger.service.js";
import { createTaxRule, createFeeRule } from "./rules.service.js";
import { createTaxWallet, listTaxWallets, createSweep, listSweeps, getAccruedTaxLiability } from "./sweep.service.js";
import { createRemittance, patchRemittance, listRemittances } from "./remittance.service.js";
import { runReconciliation, getLatestReconciliation } from "./reconciliation.service.js";
import { mintXch } from "./xch.service.js";

const idParamSchema = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } };

const mintSchema = z.object({
  userId: z.string().uuid(),
  amountNgn: z.string(),
  reference: z.string().optional(),
});

const taxRuleSchema = z.object({
  taxType: z.enum(["WHT", "VAT", "STAMP"]),
  eventType: z.enum(["SWAP", "CASHOUT", "BILL_PAYMENT"]),
  assetCategory: z.enum(["NON_STABLE", "STABLECOIN"]).nullable().optional(),
  rateBps: z.number().int().optional(),
  flatAmountMinor: z.string().optional(),
  flatCurrencyAssetId: z.string().uuid().optional(),
  base: z.enum(["GROSS", "FEE", "PER_TXN"]),
  collectIn: z.enum(["SOURCE_TOKEN", "FEE_CURRENCY", "NGN"]),
  thresholdMinor: z.string().optional(),
  effectiveFrom: z.string().datetime().optional(),
});

const feeRuleSchema = z.object({
  eventType: z.enum(["SWAP", "CASHOUT", "BILL_PAYMENT"]),
  assetId: z.string().uuid().nullable().optional(),
  type: z.enum(["PERCENT", "FLAT"]),
  rateBps: z.number().int().optional(),
  flatAmountMinor: z.string().optional(),
  chargeIn: z.enum(["SOURCE_TOKEN", "FEE_CURRENCY", "NGN"]),
  base: z.enum(["GROSS", "FEE", "PER_TXN"]),
  effectiveFrom: z.string().datetime().optional(),
});

const walletSchema = z.object({
  assetId: z.string().uuid(),
  addressOrAccount: z.string().min(1),
  custodyProvider: z.string().min(1),
});

const sweepSchema = z.object({
  taxType: z.enum(["WHT", "VAT", "STAMP"]),
  assetId: z.string().uuid(),
  txHashOrRef: z.string().optional(),
});

const remittanceSchema = z.object({
  taxType: z.enum(["WHT", "VAT", "STAMP"]),
  assetId: z.string().uuid(),
  amountMinor: z.string(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  txHashOrRef: z.string().optional(),
  nrsReceiptRef: z.string().optional(),
  documentUrl: z.string().optional(),
});

const remittancePatchSchema = z.object({
  txHashOrRef: z.string().optional(),
  nrsReceiptRef: z.string().optional(),
  documentUrl: z.string().optional(),
});

export async function adminTaxRoutes(app: FastifyInstance) {
  app.post(
    "/admin/xch/mint",
    {
      preHandler: [requireAdmin, requireOwnerAdmin],
      schema: {
        tags: ["admin"],
        summary: "Test-only: mint XCH (NGN) into a user's balance until Quickteller is wired up for real bank-deposit minting",
        security: [{ bearerAuth: [] }],
      },
    },
    async (req, reply) => {
      const body = mintSchema.parse(req.body);
      try {
        const amountKobo = BigInt(Math.round(Number(body.amountNgn) * 100)).toString();
        await mintXch(body.userId, amountKobo, body.reference ?? `admin-mint:${req.adminId}:${Date.now()}`);
        return reply.code(201).send({ ok: true });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/admin/tax/liabilities",
    { preHandler: requireAdmin, schema: { tags: ["admin"], summary: "Accrued/swept/remitted balances per tax type x asset", security: [{ bearerAuth: [] }] } },
    async (_req, reply) => {
      const assets = await prisma.asset.findMany({ where: { isActive: true } });
      const results = [];
      for (const asset of assets) {
        for (const taxType of ["WHT", "VAT", "STAMP"] as const) {
          const accrued = await getAccruedTaxLiability(taxType, asset.id);
          if (accrued === 0n) continue;
          results.push({ asset: `${asset.symbol}/${asset.chain}`, assetId: asset.id, taxType, accruedLiabilityMinor: accrued.toString() });
        }
        const taxWalletId = await getSystemAccountId("TAX_WALLET", asset.id);
        const taxWalletBalance = await getAccountBalance(taxWalletId);
        if (!taxWalletBalance.isZero()) {
          results.push({ asset: `${asset.symbol}/${asset.chain}`, assetId: asset.id, taxWalletBalanceMinor: taxWalletBalance.toFixed(0) });
        }
      }
      return reply.send({ liabilities: results });
    },
  );

  app.get(
    "/admin/tax/rules",
    { preHandler: requireAdmin, schema: { tags: ["admin"], summary: "List tax rule versions", security: [{ bearerAuth: [] }] } },
    async (_req, reply) => reply.send({ rules: await prisma.taxRule.findMany({ orderBy: { createdAt: "desc" } }) }),
  );

  app.post(
    "/admin/tax/rules",
    { preHandler: [requireAdmin, requireOwnerAdmin], schema: { tags: ["admin"], summary: "Create a new tax rule version (never edits in place)", security: [{ bearerAuth: [] }] } },
    async (req, reply) => {
      const body = taxRuleSchema.parse(req.body);
      try {
        const rule = await createTaxRule({
          ...body,
          effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
          createdByAdminId: req.adminId!,
        });
        return reply.code(201).send({ rule });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/admin/tax/fee-rules",
    { preHandler: requireAdmin, schema: { tags: ["admin"], summary: "List fee rule versions", security: [{ bearerAuth: [] }] } },
    async (_req, reply) => reply.send({ rules: await prisma.feeRule.findMany({ orderBy: { createdAt: "desc" } }) }),
  );

  app.post(
    "/admin/tax/fee-rules",
    { preHandler: [requireAdmin, requireOwnerAdmin], schema: { tags: ["admin"], summary: "Create a new fee rule version", security: [{ bearerAuth: [] }] } },
    async (req, reply) => {
      const body = feeRuleSchema.parse(req.body);
      try {
        const rule = await createFeeRule({
          ...body,
          effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
          createdByAdminId: req.adminId!,
        });
        return reply.code(201).send({ rule });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/admin/tax/wallets",
    { preHandler: requireAdmin, schema: { tags: ["admin"], summary: "List tax wallets", security: [{ bearerAuth: [] }] } },
    async (_req, reply) => reply.send({ wallets: await listTaxWallets() }),
  );

  app.post(
    "/admin/tax/wallets",
    { preHandler: [requireAdmin, requireOwnerAdmin], schema: { tags: ["admin"], summary: "Register a tax wallet", security: [{ bearerAuth: [] }] } },
    async (req, reply) => {
      const body = walletSchema.parse(req.body);
      const wallet = await createTaxWallet({ ...body, adminId: req.adminId! });
      return reply.code(201).send({ wallet });
    },
  );

  app.get(
    "/admin/tax/sweeps",
    { preHandler: requireAdmin, schema: { tags: ["admin"], summary: "List sweeps", security: [{ bearerAuth: [] }] } },
    async (_req, reply) => reply.send({ sweeps: await listSweeps() }),
  );

  app.post(
    "/admin/tax/sweeps",
    { preHandler: [requireAdmin, requireOwnerAdmin], schema: { tags: ["admin"], summary: "Sweep accrued tax from treasury into the tax wallet", security: [{ bearerAuth: [] }] } },
    async (req, reply) => {
      const body = sweepSchema.parse(req.body);
      try {
        const sweep = await createSweep({ ...body, adminId: req.adminId! });
        return reply.code(201).send({ sweep });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/admin/tax/remittances",
    { preHandler: requireAdmin, schema: { tags: ["admin"], summary: "List remittances", security: [{ bearerAuth: [] }] } },
    async (_req, reply) => reply.send({ remittances: await listRemittances() }),
  );

  app.post(
    "/admin/tax/remittances",
    { preHandler: [requireAdmin, requireOwnerAdmin], schema: { tags: ["admin"], summary: "Record a payment made to the NRS", security: [{ bearerAuth: [] }] } },
    async (req, reply) => {
      const body = remittanceSchema.parse(req.body);
      try {
        const remittance = await createRemittance({
          ...body,
          periodStart: new Date(body.periodStart),
          periodEnd: new Date(body.periodEnd),
          adminId: req.adminId!,
        });
        return reply.code(201).send({ remittance });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.patch(
    "/admin/tax/remittances/:id",
    { preHandler: [requireAdmin, requireOwnerAdmin], schema: { tags: ["admin"], summary: "Attach an NRS receipt/document to a remittance", security: [{ bearerAuth: [] }], params: idParamSchema } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = remittancePatchSchema.parse(req.body);
      try {
        const remittance = await patchRemittance(id, body, req.adminId!);
        return reply.send({ remittance });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/admin/tax/reconciliation/latest",
    { preHandler: requireAdmin, schema: { tags: ["admin"], summary: "Latest reconciliation run", security: [{ bearerAuth: [] }] } },
    async (_req, reply) => reply.send({ run: await getLatestReconciliation() }),
  );

  app.post(
    "/admin/tax/reconciliation/run",
    { preHandler: [requireAdmin, requireOwnerAdmin], schema: { tags: ["admin"], summary: "Run reconciliation now", security: [{ bearerAuth: [] }] } },
    async (_req, reply) => reply.send({ run: await runReconciliation() }),
  );
}
