-- AlterTable
ALTER TABLE "users" ADD COLUMN     "passwordFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "passwordLockedUntil" TIMESTAMP(3);
