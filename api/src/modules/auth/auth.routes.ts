import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requestLoginOtp, verifyLoginOtp } from "./otp.service.js";
import { identify, loginWithPassword, setPassword, changePassword } from "./password.service.js";
import { requireAuth } from "./require-auth.js";
import { rotateSession, revokeSession } from "./session.service.js";

const REFRESH_COOKIE = "moonxch_refresh";

const emailSchema = z.object({ email: z.string().email() });
const verifySchema = z.object({ email: z.string().email(), code: z.string().length(6) });
const passwordLoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const passwordSetSchema = z.object({ password: z.string().min(8) });
const passwordChangeSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) });

const emailBodyJsonSchema = {
  type: "object",
  required: ["email"],
  properties: { email: { type: "string", format: "email" } },
};

export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/auth/identify",
    {
      schema: {
        tags: ["auth"],
        summary: "Check whether an email is registered and has a password set",
        body: emailBodyJsonSchema,
        response: {
          200: {
            type: "object",
            properties: { exists: { type: "boolean" }, hasPassword: { type: "boolean" } },
          },
        },
      },
    },
    async (req, reply) => {
      const { email } = emailSchema.parse(req.body);
      const result = await identify(email);
      return reply.send(result);
    },
  );

  app.post(
    "/auth/password/login",
    {
      schema: {
        tags: ["auth"],
        summary: "Log in with email + password (only once a password is set)",
        body: {
          type: "object",
          required: ["email", "password"],
          properties: { email: { type: "string", format: "email" }, password: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { accessToken: { type: "string" } } },
          "4xx": { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const { email, password } = passwordLoginSchema.parse(req.body);
      try {
        const { accessToken, refreshToken } = await loginWithPassword(email, password, req.headers["user-agent"]);
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
    "/auth/password/set",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["auth"],
        summary: "Set this (already-authenticated) user's password",
        security: [{ bearerAuth: [] }],
        body: { type: "object", required: ["password"], properties: { password: { type: "string", minLength: 8 } } },
        response: {
          200: { type: "object", properties: { ok: { type: "boolean" } } },
          "4xx": { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const { password } = passwordSetSchema.parse(req.body);
      try {
        await setPassword(req.userId!, password);
        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/auth/password/change",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["auth"],
        summary: "Change this user's password (requires the current one)",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string" },
            newPassword: { type: "string", minLength: 8 },
          },
        },
        response: {
          200: { type: "object", properties: { ok: { type: "boolean" } } },
          "4xx": { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const { currentPassword, newPassword } = passwordChangeSchema.parse(req.body);
      try {
        await changePassword(req.userId!, currentPassword, newPassword);
        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

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
          200: {
            type: "object",
            properties: { accessToken: { type: "string" }, needsPassword: { type: "boolean" } },
          },
          "4xx": { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const { email, code } = verifySchema.parse(req.body);
      try {
        const { accessToken, refreshToken, needsPassword } = await verifyLoginOtp(email, code, req.headers["user-agent"]);
        reply.setCookie(REFRESH_COOKIE, refreshToken, {
          httpOnly: true,
          secure: true,
          sameSite: "none",
          path: "/auth",
        });
        return reply.send({ accessToken, needsPassword });
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
