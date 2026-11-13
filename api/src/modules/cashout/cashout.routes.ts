import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/require-auth.js";
import { requireAdmin } from "../admin/require-admin.js";
import {
  getCashoutStatus,
  submitLegalName,
  resendCashoutOtp,
  verifyCashoutOtp,
  saveBankAccount,
} from "./cashout.service.js";
import {
  createCashoutRequest,
  listCashoutRequestsForUser,
  listPendingCashoutRequests,
  markCashoutPaid,
  rejectCashoutRequest,
  InsufficientBalanceError,
} from "./cashout-request.service.js";

const nameSchema = z.object({
  firstName: z.string().trim().min(1),
  middleName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1),
});

const verifySchema = z.object({ code: z.string().length(6) });

const bankSchema = z.object({
  bankName: z.string().trim().min(1),
  accountNumber: z.string().trim().min(1),
});

const createRequestSchema = z.object({
  sourceAssetId: z.string().uuid(),
  ngnAmount: z.string(),
});

const rejectSchema = z.object({ notes: z.string().optional() });

const idParamSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
};

export async function cashoutRoutes(app: FastifyInstance) {
  app.get(
    "/cashout/profile",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["cashout"],
        summary: "Get this user's cash-out profile setup status",
        security: [{ bearerAuth: [] }],
      },
    },
    async (req, reply) => {
      const status = await getCashoutStatus(req.userId!);
      return reply.send(status);
    },
  );

  app.post(
    "/cashout/profile/name",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["cashout"],
        summary: "Save legal name and send an email verification code",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["firstName", "lastName"],
          properties: {
            firstName: { type: "string" },
            middleName: { type: "string" },
            lastName: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const { firstName, middleName, lastName } = nameSchema.parse(req.body);
      try {
        await submitLegalName(req.userId!, firstName, middleName, lastName);
        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/cashout/otp/resend",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["cashout"],
        summary: "Resend the cash-out email verification code",
        security: [{ bearerAuth: [] }],
      },
    },
    async (req, reply) => {
      try {
        await resendCashoutOtp(req.userId!);
        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/cashout/otp/verify",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["cashout"],
        summary: "Verify the 6-digit code sent to the user's email",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["code"],
          properties: { code: { type: "string", minLength: 6, maxLength: 6 } },
        },
      },
    },
    async (req, reply) => {
      const { code } = verifySchema.parse(req.body);
      try {
        await verifyCashoutOtp(req.userId!, code);
        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/cashout/bank",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["cashout"],
        summary: "Save the bank account to cash out to",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["bankName", "accountNumber"],
          properties: {
            bankName: { type: "string" },
            accountNumber: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const { bankName, accountNumber } = bankSchema.parse(req.body);
      try {
        await saveBankAccount(req.userId!, bankName, accountNumber);
        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/cashout/request",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["cashout"],
        summary: "Cash out: swap the chosen asset to USDC (if needed) and queue an NGN payout",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["sourceAssetId", "ngnAmount"],
          properties: {
            sourceAssetId: { type: "string", format: "uuid" },
            ngnAmount: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const { sourceAssetId, ngnAmount } = createRequestSchema.parse(req.body);
      try {
        const request = await createCashoutRequest({ userId: req.userId!, sourceAssetId, ngnAmount });
        return reply.code(201).send({ request });
      } catch (err) {
        if (err instanceof InsufficientBalanceError) {
          return reply.code(400).send({ error: "Insufficient balance for this cash-out" });
        }
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/cashout/requests",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["cashout"],
        summary: "This user's cash-out request history",
        security: [{ bearerAuth: [] }],
      },
    },
    async (req, reply) => {
      const requests = await listCashoutRequestsForUser(req.userId!);
      return reply.send({ requests });
    },
  );

  app.get(
    "/admin/cashout-requests",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "List pending cash-out requests awaiting manual NGN payout",
        security: [{ bearerAuth: [] }],
      },
    },
    async (_req, reply) => {
      const requests = await listPendingCashoutRequests();
      return reply.send({ requests });
    },
  );

  app.post(
    "/admin/cashout-requests/:id/mark-paid",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Record that the NGN payout was sent to the user's bank account",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const request = await markCashoutPaid(id, req.adminId!);
        return reply.send({ request });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/admin/cashout-requests/:id/reject",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Reject a pending cash-out request and refund the held USDC",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        body: {
          type: "object",
          properties: { notes: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { notes } = rejectSchema.parse(req.body);
      const { id } = req.params as { id: string };
      try {
        const request = await rejectCashoutRequest(id, req.adminId!, notes);
        return reply.send({ request });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
