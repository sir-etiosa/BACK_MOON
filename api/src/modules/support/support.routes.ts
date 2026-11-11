import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/require-auth.js";
import { requireAdmin } from "../admin/require-admin.js";
import {
  createTicket,
  replyAsUser,
  replyAsAdmin,
  getOpenTicketsForUser,
  getTicketForUser,
  getAllTicketsForAdmin,
  clearTicket,
} from "./support.service.js";

const messageSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

const idParamSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
};

export async function supportRoutes(app: FastifyInstance) {
  app.post(
    "/support-messages",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["support"],
        summary: "Open a new support ticket — capped at 5 new tickets per user per rolling day",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["message"],
          properties: { message: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { ok: { type: "boolean" } } },
          "4xx": { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const { message } = messageSchema.parse(req.body);
      try {
        await createTicket(req.userId!, message);
        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(429).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/support-messages",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["support"],
        summary: "Your open support tickets, with full message thread",
        security: [{ bearerAuth: [] }],
      },
    },
    async (req) => {
      const tickets = await getOpenTicketsForUser(req.userId!);
      return { tickets };
    },
  );

  app.get(
    "/support-messages/:id",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["support"],
        summary: "A single ticket's message thread",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const ticket = await getTicketForUser(id, req.userId!);
        return reply.send({ ticket });
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/support-messages/:id/reply",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["support"],
        summary: "Reply within an existing ticket (reopens it if closed)",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        body: {
          type: "object",
          required: ["message"],
          properties: { message: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { message } = messageSchema.parse(req.body);
      try {
        const msg = await replyAsUser(id, req.userId!, message);
        return reply.send({ message: msg });
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/admin/support-messages",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "All support tickets (open and cleared) with full message threads",
        security: [{ bearerAuth: [] }],
      },
    },
    async () => {
      const tickets = await getAllTicketsForAdmin();
      return { tickets };
    },
  );

  app.post(
    "/admin/support-messages/:id/reply",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Reply to a user within a support ticket",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        body: {
          type: "object",
          required: ["message"],
          properties: { message: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { message } = messageSchema.parse(req.body);
      try {
        const msg = await replyAsAdmin(id, message);
        return reply.send({ message: msg });
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/admin/support-messages/:id/clear",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Close a support ticket — removes it from the user's open history",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const ticket = await clearTicket(id);
      return { ticket };
    },
  );
}
