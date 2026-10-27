import crypto from "node:crypto";
import bcrypt from "bcryptjs";

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

export function generateOtpCode(): string {
  // 6-digit numeric code, zero-padded.
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function hashOtpCode(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

export async function verifyOtpCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

export function otpExpiry(): Date {
  return new Date(Date.now() + OTP_TTL_MS);
}

export { OTP_MAX_ATTEMPTS };
