import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loginAdmin } from "./admin-auth.service.js";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

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
        response: { 200: { type: "object", properties: { accessToken: { type: "string" } } }, "4xx": { type: "object", properties: { error: { type: "string" } } } },
      },
    },
    async (req, reply) => {
      const { email, password } = loginSchema.parse(req.body);
      try {
        const token = await loginAdmin(email, password);
        return reply.send({ accessToken: token });
      } catch (err) {
        return reply.code(401).send({ error: (err as Error).message });
      }
    },
  );
}
