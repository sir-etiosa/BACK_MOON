import { prisma } from "../../db/prisma.js";
import { mailer } from "./mailer.js";
import { OTP_MAX_ATTEMPTS, generateOtpCode, hashOtpCode, otpExpiry, verifyOtpCode } from "./otp.util.js";
import { createSession } from "./session.service.js";

const RESEND_COOLDOWN_MS = 30 * 1000;

export async function requestLoginOtp(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.upsert({
    where: { email: normalizedEmail },
    create: { email: normalizedEmail },
    update: {},
  });

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

  await mailer.sendOtp(normalizedEmail, code);
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

  return createSession(user.id, deviceInfo);
}
