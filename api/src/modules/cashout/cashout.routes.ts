import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/require-auth.js";
import {
  getCashoutStatus,
  submitLegalName,
  resendCashoutOtp,
  verifyCashoutOtp,
  saveBankAccount,
} from "./cashout.service.js";

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
}
