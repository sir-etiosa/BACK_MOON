import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function signAccessToken(userId: string, sessionId: string): string {
  return jwt.sign({ sub: userId, sid: sessionId }, env.APP_JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): { userId: string; sessionId: string } {
  const payload = jwt.verify(token, env.APP_JWT_SECRET) as jwt.JwtPayload;
  return { userId: payload.sub as string, sessionId: payload.sid as string };
}

/** Issues a fresh session: opaque refresh token (returned once, plaintext) + its hash stored in DB. */
export async function createSession(userId: string, deviceInfo?: string) {
  const refreshToken = crypto.randomBytes(32).toString("hex");
  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hashToken(refreshToken),
      deviceInfo,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  const accessToken = signAccessToken(userId, session.id);
  return { accessToken, refreshToken, sessionId: session.id };
}

/** Rotates a refresh token: the old one stops working the moment a new one is issued. */
export async function rotateSession(refreshToken: string) {
  const tokenHash = hashToken(refreshToken);
  const session = await prisma.session.findUnique({ where: { refreshTokenHash: tokenHash } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new Error("Invalid or expired refresh token");
  }

  const newRefreshToken = crypto.randomBytes(32).toString("hex");
  await prisma.$transaction([
    prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } }),
    prisma.session.create({
      data: {
        userId: session.userId,
        refreshTokenHash: hashToken(newRefreshToken),
        deviceInfo: session.deviceInfo,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    }),
  ]);

  const fresh = await prisma.session.findUnique({ where: { refreshTokenHash: hashToken(newRefreshToken) } });
  const accessToken = signAccessToken(session.userId, fresh!.id);
  return { accessToken, refreshToken: newRefreshToken, sessionId: fresh!.id };
}

export async function revokeSession(refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  await prisma.session.updateMany({
    where: { refreshTokenHash: tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
