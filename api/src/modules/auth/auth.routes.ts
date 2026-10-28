import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requestLoginOtp, verifyLoginOtp } from "./otp.service.js";
import { rotateSession, revokeSession } from "./session.service.js";

const REFRESH_COOKIE = "moonxch_refresh";

const emailSchema = z.object({ email: z.string().email() });
const verifySchema = z.object({ email: z.string().email(), code: z.string().length(6) });

const emailBodyJsonSchema = {
  type: "object",
  required: ["email"],
  properties: { email: { type: "string", format: "email" } },
};

export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/auth/otp/request",
    {
      schema: {
        tags: ["auth"],
        summary: "Request a login OTP (also signs up new emails)",
        body: emailBodyJsonSchema,
        response: { 200: { type: "object", properties: { ok: { type: "boolean" } } }, "4xx": { type: "object", properties: { error: { type: "string" } } } },
      },
    },
    async (req, reply) => {
      const { email } = emailSchema.parse(req.body);
      try {
        await requestLoginOtp(email);
      } catch (err) {
        return reply.code(429).send({ error: (err as Error).message });
      }
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/auth/otp/verify",
    {
      schema: {
        tags: ["auth"],
        summary: "Verify the OTP and start a session",
        body: {
          type: "object",
          required: ["email", "code"],
          properties: {
            email: { type: "string", format: "email" },
            code: { type: "string", minLength: 6, maxLength: 6 },
          },
        },
        response: {
          200: { type: "object", properties: { accessToken: { type: "string" } } },
          "4xx": { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const { email, code } = verifySchema.parse(req.body);
      try {
        const { accessToken, refreshToken } = await verifyLoginOtp(email, code, req.headers["user-agent"]);
        reply.setCookie(REFRESH_COOKIE, refreshToken, {
          httpOnly: true,
          secure: true,
          sameSite: "none",
          path: "/auth",
        });
        return reply.send({ accessToken });
      } catch (err) {
        return reply.code(401).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/auth/refresh",
    {
      schema: {
        tags: ["auth"],
        summary: "Rotate the refresh-token cookie for a new access token",
        response: { 200: { type: "object", properties: { accessToken: { type: "string" } } }, "4xx": { type: "object", properties: { error: { type: "string" } } } },
      },
    },
    async (req, reply) => {
      const refreshToken = req.cookies[REFRESH_COOKIE];
      if (!refreshToken) return reply.code(401).send({ error: "No session" });
      try {
        const { accessToken, refreshToken: next } = await rotateSession(refreshToken);
        reply.setCookie(REFRESH_COOKIE, next, {
          httpOnly: true,
          secure: true,
          sameSite: "none",
          path: "/auth",
        });
        return reply.send({ accessToken });
      } catch (err) {
        return reply.code(401).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/auth/logout",
    { schema: { tags: ["auth"], summary: "Revoke the current session" } },
    async (req, reply) => {
      const refreshToken = req.cookies[REFRESH_COOKIE];
      if (refreshToken) await revokeSession(refreshToken);
      reply.clearCookie(REFRESH_COOKIE, { path: "/auth" });
      return reply.send({ ok: true });
    },
  );
}
