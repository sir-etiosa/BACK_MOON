-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "support_messages" ADD COLUMN     "cleared_at" TIMESTAMP(3),
ADD COLUMN     "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN';

-- CreateIndex
CREATE INDEX "support_messages_status_created_at_idx" ON "support_messages"("status", "created_at");
