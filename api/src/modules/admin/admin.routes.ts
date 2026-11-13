import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loginAdmin } from "./admin-auth.service.js";
import { requireAdmin, requireOwnerAdmin } from "./require-admin.js";
import { createSubAdmin, listAdmins } from "./admin-management.service.js";
import { getNgnRate, setNgnRate } from "./settings.service.js";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const createAdminSchema = z.object({ email: z.string().email(), password: z.string().min(12) });
const rateSchema = z.object({ rate: z.number().positive() });

export async function adminRoutes(app: FastifyInstance) {
  app.post(
    "/admin/login",
    {
      schema: {
        tags: ["admin"],
        summary: "Admin login",
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
        response: { 200: { type: "object", properties: { accessToken: { type: "string" }, role: { type: "string" } } }, "4xx": { type: "object", properties: { error: { type: "string" } } } },
      },
    },
    async (req, reply) => {
      const { email, password } = loginSchema.parse(req.body);
      try {
        const { accessToken, role } = await loginAdmin(email, password);
        return reply.send({ accessToken, role });
      } catch (err) {
        return reply.code(401).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/admin/admins",
    {
      preHandler: [requireAdmin, requireOwnerAdmin],
      schema: {
        tags: ["admin"],
        summary: "Owner only: list admin accounts",
        security: [{ bearerAuth: [] }],
      },
    },
    async (_req, reply) => {
      const admins = await listAdmins();
      return reply.send({ admins });
    },
  );

  app.post(
    "/admin/admins",
    {
      preHandler: [requireAdmin, requireOwnerAdmin],
      schema: {
        tags: ["admin"],
        summary: "Owner only: create a sub-admin (operator role)",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const { email, password } = createAdminSchema.parse(req.body);
      try {
        const admin = await createSubAdmin(email, password);
        return reply.code(201).send({ admin });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/admin/rate",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Current USD->NGN rate used for cash-out pricing",
        security: [{ bearerAuth: [] }],
      },
    },
    async (_req, reply) => {
      const rate = await getNgnRate();
      return reply.send({ rate });
    },
  );

  app.post(
    "/admin/rate",
    {
      preHandler: [requireAdmin, requireOwnerAdmin],
      schema: {
        tags: ["admin"],
        summary: "Owner only: set the USD->NGN rate used for cash-out pricing",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["rate"],
          properties: { rate: { type: "number" } },
        },
      },
    },
    async (req, reply) => {
      const { rate } = rateSchema.parse(req.body);
      try {
        const saved = await setNgnRate(rate, req.adminId!);
        return reply.send({ rate: saved });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
