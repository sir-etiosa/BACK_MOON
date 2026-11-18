import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/require-auth.js";
import { requireAdmin } from "../admin/require-admin.js";
import { executeTaxedBillPayment, listBillRequestsForUser, listPendingBillRequests, markBillPaid, rejectBillRequest } from "../tax/bill.service.js";
import { InsufficientBalanceError } from "../../ledger/ledger.service.js";

const requestSchema = z.object({
  billAmountNgn: z.string(),
  assetSymbol: z.string().min(1),
  billerCategory: z.string().min(1),
  billerRef: z.string().optional(),
});

const rejectSchema = z.object({ notes: z.string().optional() });

const idParamSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
};

/** No real biller integration exists yet (airtime/electricity/cable APIs) — this
 * collapses quote+execute into one call like /trade/swap, withholds WHT/fee/VAT per
 * the active tax rules, and queues the request for manual admin settlement, same
 * operational pattern as cash-outs. */
export async function billRoutes(app: FastifyInstance) {
  app.post(
    "/bills/request",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["bills"],
        summary: "Pay a bill with crypto — withholds WHT/fee/VAT per the active tax rules, queues for manual settlement",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["billAmountNgn", "assetSymbol", "billerCategory"],
          properties: {
            billAmountNgn: { type: "string", description: "Naira bill amount, must be paid in full" },
            assetSymbol: { type: "string", description: "Symbol to pay with, e.g. ETH — combined across chains" },
            billerCategory: { type: "string", description: "e.g. airtime, data, electricity, cable, internet, school" },
            billerRef: { type: "string", description: "Meter number / phone number / account reference" },
          },
        },
      },
    },
    async (req, reply) => {
      const body = requestSchema.parse(req.body);
      try {
        const request = await executeTaxedBillPayment({ userId: req.userId!, ...body });
        return reply.code(201).send({ request });
      } catch (err) {
        if (err instanceof InsufficientBalanceError) {
          return reply.code(400).send({ error: "Insufficient balance for this bill payment" });
        }
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/bills/requests",
    {
      preHandler: requireAuth,
      schema: { tags: ["bills"], summary: "This user's bill payment history", security: [{ bearerAuth: [] }] },
    },
    async (req, reply) => {
      const requests = await listBillRequestsForUser(req.userId!);
      return reply.send({ requests });
    },
  );

  app.get(
    "/admin/bill-requests",
    {
      preHandler: requireAdmin,
      schema: { tags: ["admin"], summary: "List pending bill payment requests awaiting manual settlement", security: [{ bearerAuth: [] }] },
    },
    async (_req, reply) => {
      const requests = await listPendingBillRequests();
      return reply.send({ requests });
    },
  );

  app.post(
    "/admin/bill-requests/:id/mark-paid",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Record that the biller was settled",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const request = await markBillPaid(id, req.adminId!);
        return reply.send({ request });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/admin/bill-requests/:id/reject",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Reject a pending bill payment request and reverse every ledger leg",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        body: { type: "object", properties: { notes: { type: "string" } } },
      },
    },
    async (req, reply) => {
      const { notes } = rejectSchema.parse(req.body);
      const { id } = req.params as { id: string };
      try {
        const request = await rejectBillRequest(id, req.adminId!, notes);
        return reply.send({ request });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
