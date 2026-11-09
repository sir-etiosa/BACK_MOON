import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { loginOtpEmail, welcomeOtpEmail } from "../../email/templates.js";
import { mailer } from "./mailer.js";
import { OTP_MAX_ATTEMPTS, generateOtpCode, hashOtpCode, otpExpiry, verifyOtpCode } from "./otp.util.js";
import { createSession } from "./session.service.js";

const RESEND_COOLDOWN_MS = 30 * 1000;

export async function requestLoginOtp(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();

  // Try create first (atomic, race-safe) so we can tell a brand-new signup from a
  // returning user without a separate read-then-write that two concurrent requests
  // could both see as "doesn't exist yet".
  let user;
  let isNewUser = true;
  try {
    user = await prisma.user.create({ data: { email: normalizedEmail } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      isNewUser = false;
      user = await prisma.user.findUniqueOrThrow({ where: { email: normalizedEmail } });
    } else {
      throw err;
    }
  }

  const recent = await prisma.authOtp.findFirst({
    where: { userId: user.id, purpose: "LOGIN" },
    orderBy: { createdAt: "desc" },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new Error("Please wait before requesting another code");
  }

  const code = generateOtpCode();
  const codeHash = await hashOtpCode(code);

  await prisma.authOtp.create({
    data: { userId: user.id, codeHash, purpose: "LOGIN", expiresAt: otpExpiry() },
  });

  const { subject, text, html } = isNewUser ? welcomeOtpEmail(code) : loginOtpEmail(code);
  await mailer.send(normalizedEmail, subject, text, html);
}

export async function verifyLoginOtp(email: string, code: string, deviceInfo?: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) throw new Error("Invalid email or code");

  const otp = await prisma.authOtp.findFirst({
    where: { userId: user.id, purpose: "LOGIN", consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) throw new Error("Invalid email or code");

  if (otp.expiresAt < new Date()) throw new Error("Code expired, request a new one");
  if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new Error("Too many attempts, request a new code");

  const valid = await verifyOtpCode(code, otp.codeHash);
  if (!valid) {
    await prisma.authOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw new Error("Invalid email or code");
  }

  await prisma.authOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  if (!user.emailVerifiedAt) {
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }

  const session = await createSession(user.id, deviceInfo);
  return { ...session, needsPassword: !user.passwordHash };
}
