-- CreateEnum
CREATE TYPE "CashoutRequestStatus" AS ENUM ('PENDING', 'PAID', 'REJECTED');

-- AlterEnum
ALTER TYPE "LedgerRefType" ADD VALUE 'CASHOUT';

-- CreateTable
CREATE TABLE "cashout_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_asset_id" TEXT NOT NULL,
    "source_amount" DECIMAL(38,0) NOT NULL,
    "trade_id" TEXT,
    "usdc_asset_id" TEXT NOT NULL,
    "usdc_amount" DECIMAL(38,0) NOT NULL,
    "ngn_rate" DECIMAL(18,4) NOT NULL,
    "ngn_amount" DECIMAL(18,2) NOT NULL,
    "account_name" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "status" "CashoutRequestStatus" NOT NULL DEFAULT 'PENDING',
    "processed_by_admin_id" TEXT,
    "processed_at" TIMESTAMP(3),
    "notes" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cashout_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by_admin_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "cashout_requests_status_idx" ON "cashout_requests"("status");

-- AddForeignKey
ALTER TABLE "cashout_requests" ADD CONSTRAINT "cashout_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashout_requests" ADD CONSTRAINT "cashout_requests_source_asset_id_fkey" FOREIGN KEY ("source_asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashout_requests" ADD CONSTRAINT "cashout_requests_usdc_asset_id_fkey" FOREIGN KEY ("usdc_asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
