import { prisma } from "../../db/prisma.js";
import { cashoutOtpEmail } from "../../email/templates.js";
import { mailer } from "../auth/mailer.js";
import { OTP_MAX_ATTEMPTS, generateOtpCode, hashOtpCode, otpExpiry, verifyOtpCode } from "../auth/otp.util.js";

const RESEND_COOLDOWN_MS = 30 * 1000;

export interface CashoutProfileStatus {
  step: "name" | "otp" | "bank" | "done";
  email: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  bankName: string | null;
  accountNumber: string | null;
}

async function sendCashoutOtp(userId: string, email: string): Promise<void> {
  const recent = await prisma.authOtp.findFirst({
    where: { userId, purpose: "CASHOUT" },
    orderBy: { createdAt: "desc" },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new Error("Please wait before requesting another code");
  }

  const code = generateOtpCode();
  const codeHash = await hashOtpCode(code);
  await prisma.authOtp.create({
    data: { userId, codeHash, purpose: "CASHOUT", expiresAt: otpExpiry() },
  });

  const { subject, text, html } = cashoutOtpEmail(code);
  await mailer.send(email, subject, text, html);
}

export async function getCashoutStatus(userId: string): Promise<CashoutProfileStatus> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const profile = await prisma.cashoutProfile.findUnique({ where: { userId } });

  let step: CashoutProfileStatus["step"] = "name";
  if (profile) {
    if (profile.bankName && profile.accountNumber) step = "done";
    else if (profile.verifiedAt) step = "bank";
    else step = "otp";
  }

  return {
    step,
    email: user.email,
    firstName: profile?.firstName ?? null,
    middleName: profile?.middleName ?? null,
    lastName: profile?.lastName ?? null,
    bankName: profile?.bankName ?? null,
    accountNumber: profile?.accountNumber ?? null,
  };
}

export async function submitLegalName(
  userId: string,
  firstName: string,
  middleName: string | undefined,
  lastName: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  await prisma.cashoutProfile.upsert({
    where: { userId },
    create: { userId, firstName, middleName, lastName },
    update: { firstName, middleName, lastName, verifiedAt: null },
  });

  await sendCashoutOtp(userId, user.email);
}

export async function resendCashoutOtp(userId: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const profile = await prisma.cashoutProfile.findUnique({ where: { userId } });
  if (!profile) throw new Error("Enter your legal name first");
  await sendCashoutOtp(userId, user.email);
}

export async function verifyCashoutOtp(userId: string, code: string): Promise<void> {
  const profile = await prisma.cashoutProfile.findUnique({ where: { userId } });
  if (!profile) throw new Error("Enter your legal name first");

  const otp = await prisma.authOtp.findFirst({
    where: { userId, purpose: "CASHOUT", consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) throw new Error("Invalid or expired code");
  if (otp.expiresAt < new Date()) throw new Error("Code expired, request a new one");
  if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new Error("Too many attempts, request a new code");

  const valid = await verifyOtpCode(code, otp.codeHash);
  if (!valid) {
    await prisma.authOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw new Error("Invalid code");
  }

  await prisma.authOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  await prisma.cashoutProfile.update({ where: { userId }, data: { verifiedAt: new Date() } });
}

export async function saveBankAccount(userId: string, bankName: string, accountNumber: string): Promise<void> {
  const profile = await prisma.cashoutProfile.findUnique({ where: { userId } });
  if (!profile) throw new Error("Enter your legal name first");
  if (!profile.verifiedAt) throw new Error("Verify your email first");

  await prisma.cashoutProfile.update({
    where: { userId },
    data: { bankName, accountNumber, completedAt: new Date() },
  });
}
