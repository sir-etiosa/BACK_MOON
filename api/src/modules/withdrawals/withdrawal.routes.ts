import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/require-auth.js";
import { requireAdmin } from "../admin/require-admin.js";
import {
  requestWithdrawal,
  listWithdrawalsForUser,
  listPendingWithdrawals,
  markWithdrawalSent,
  confirmWithdrawal,
  rejectWithdrawal,
  InsufficientBalanceError,
} from "./withdrawal.service.js";

const requestSchema = z.object({
  assetId: z.string().uuid(),
  toAddress: z.string().min(1),
  amount: z.string(),
});

const markSentSchema = z.object({ txHash: z.string().min(1) });
const rejectSchema = z.object({ notes: z.string().optional() });

const idParamSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
};

export async function withdrawalRoutes(app: FastifyInstance) {
  app.post(
    "/withdrawals",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["withdrawals"],
        summary: "Request a withdrawal (debits the ledger immediately as a hold)",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["assetId", "toAddress", "amount"],
          properties: {
            assetId: { type: "string", format: "uuid" },
            toAddress: { type: "string" },
            amount: { type: "string", description: "Smallest units of the asset" },
          },
        },
      },
    },
    async (req, reply) => {
      const body = requestSchema.parse(req.body);
      try {
        const withdrawal = await requestWithdrawal({ userId: req.userId!, ...body });
        return reply.code(201).send({ withdrawal });
      } catch (err) {
        if (err instanceof InsufficientBalanceError) {
          return reply.code(400).send({ error: "Insufficient balance" });
        }
        throw err;
      }
    },
  );

  app.get(
    "/withdrawals",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["withdrawals"],
        summary: "This user's withdrawal history",
        security: [{ bearerAuth: [] }],
      },
    },
    async (req, reply) => {
      const withdrawals = await listWithdrawalsForUser(req.userId!);
      return reply.send({ withdrawals });
    },
  );

  app.get(
    "/admin/withdrawals",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "List pending/approved withdrawals awaiting manual processing",
        security: [{ bearerAuth: [] }],
      },
    },
    async (_req, reply) => {
      const withdrawals = await listPendingWithdrawals();
      return reply.send({ withdrawals });
    },
  );

  app.post(
    "/admin/withdrawals/:id/mark-sent",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Record the on-chain tx hash after manually sending from the phone wallet",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        body: {
          type: "object",
          required: ["txHash"],
          properties: { txHash: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { txHash } = markSentSchema.parse(req.body);
      const { id } = req.params as { id: string };
      try {
        const withdrawal = await markWithdrawalSent(id, txHash, req.adminId!);
        return reply.send({ withdrawal });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/admin/withdrawals/:id/confirm",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Confirm a withdrawal that's already been marked sent",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const withdrawal = await confirmWithdrawal(id);
        return reply.send({ withdrawal });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/admin/withdrawals/:id/reject",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Reject a pending withdrawal and refund the held balance",
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
        const withdrawal = await rejectWithdrawal(id, req.adminId!, notes);
        return reply.send({ withdrawal });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
