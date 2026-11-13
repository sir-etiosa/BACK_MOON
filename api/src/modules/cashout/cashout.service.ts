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

export interface CashoutBankAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  isDefault: boolean;
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

/** One-time migration for accounts created before multi-bank-account support existed —
 * the single bankName/accountNumber pair that used to live on CashoutProfile becomes the
 * first (default) row here, so nothing already saved in production gets lost. */
async function ensureLegacyAccountMigrated(userId: string): Promise<void> {
  const existing = await prisma.cashoutBankAccount.count({ where: { userId } });
  if (existing > 0) return;

  const profile = await prisma.cashoutProfile.findUnique({ where: { userId } });
  if (!profile?.bankName || !profile.accountNumber) return;

  await prisma.cashoutBankAccount.create({
    data: { userId, bankName: profile.bankName, accountNumber: profile.accountNumber, isDefault: true },
  });
}

export async function listBankAccounts(userId: string): Promise<CashoutBankAccount[]> {
  await ensureLegacyAccountMigrated(userId);
  return prisma.cashoutBankAccount.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, bankName: true, accountNumber: true, isDefault: true },
  });
}

export async function getCashoutStatus(userId: string): Promise<CashoutProfileStatus> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const profile = await prisma.cashoutProfile.findUnique({ where: { userId } });
  const accounts = profile ? await listBankAccounts(userId) : [];

  let step: CashoutProfileStatus["step"] = "name";
  if (profile) {
    if (accounts.length > 0) step = "done";
    else if (profile.verifiedAt) step = "bank";
    else step = "otp";
  }

  return {
    step,
    email: user.email,
    firstName: profile?.firstName ?? null,
    middleName: profile?.middleName ?? null,
    lastName: profile?.lastName ?? null,
    bankName: accounts[0]?.bankName ?? null,
    accountNumber: accounts[0]?.accountNumber ?? null,
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

function capitalizeWords(value: string): string {
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Adds a bank account for this user — the first one ever added becomes the default. */
export async function addBankAccount(userId: string, bankName: string, accountNumber: string): Promise<CashoutBankAccount> {
  const profile = await prisma.cashoutProfile.findUnique({ where: { userId } });
  if (!profile) throw new Error("Enter your legal name first");
  if (!profile.verifiedAt) throw new Error("Verify your email first");

  const existingCount = await prisma.cashoutBankAccount.count({ where: { userId } });

  const account = await prisma.cashoutBankAccount.create({
    data: {
      userId,
      bankName: capitalizeWords(bankName),
      accountNumber,
      isDefault: existingCount === 0,
    },
    select: { id: true, bankName: true, accountNumber: true, isDefault: true },
  });

  if (!profile.completedAt) {
    await prisma.cashoutProfile.update({ where: { userId }, data: { completedAt: new Date() } });
  }

  return account;
}

export async function setDefaultBankAccount(userId: string, accountId: string): Promise<void> {
  const account = await prisma.cashoutBankAccount.findUnique({ where: { id: accountId } });
  if (!account || account.userId !== userId) throw new Error("Bank account not found");

  await prisma.$transaction([
    prisma.cashoutBankAccount.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } }),
    prisma.cashoutBankAccount.update({ where: { id: accountId }, data: { isDefault: true } }),
  ]);
}
