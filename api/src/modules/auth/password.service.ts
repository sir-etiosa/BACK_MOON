import bcrypt from "bcryptjs";
import { prisma } from "../../db/prisma.js";
import { createSession } from "./session.service.js";

const PASSWORD_MAX_ATTEMPTS = 5;
const PASSWORD_LOCKOUT_MS = 15 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 8;

export function assertValidPassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
}

/** Looked up by the login screen to decide whether to show a password field or kick off OTP. */
export async function identify(email: string): Promise<{ exists: boolean; hasPassword: boolean }> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  return { exists: !!user, hasPassword: !!user?.passwordHash };
}

export async function loginWithPassword(email: string, password: string, deviceInfo?: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  // Same generic error whether the email doesn't exist, has no password set, or the
  // password is wrong — never tell an attacker which case they hit.
  const genericError = new Error("Invalid email or password");
  if (!user || !user.passwordHash) throw genericError;

  if (user.passwordLockedUntil && user.passwordLockedUntil > new Date()) {
    throw new Error("Too many failed attempts. Try again later.");
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const attempts = user.passwordFailedAttempts + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordFailedAttempts: attempts,
        passwordLockedUntil: attempts >= PASSWORD_MAX_ATTEMPTS ? new Date(Date.now() + PASSWORD_LOCKOUT_MS) : null,
      },
    });
    throw genericError;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordFailedAttempts: 0, passwordLockedUntil: null },
  });

  return createSession(user.id, deviceInfo);
}

/** Only ever called for the user attached to an already-verified session (fresh OTP login or an existing one). */
export async function setPassword(userId: string, password: string): Promise<void> {
  assertValidPassword(password);
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, passwordFailedAttempts: 0, passwordLockedUntil: null },
  });
}

/** Settings page: changing an already-set password requires the current one. */
export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash) throw new Error("No password set yet");

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw new Error("Current password is incorrect");

  assertValidPassword(newPassword);
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}
