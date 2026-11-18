-- DropForeignKey
ALTER TABLE "cashout_requests" DROP CONSTRAINT "cashout_requests_usdc_asset_id_fkey";

-- AlterTable
ALTER TABLE "cashout_requests" ADD COLUMN     "fee_ngn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "payout_ngn_amount" DECIMAL(18,2),
ADD COLUMN     "stamp_ngn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tax_transaction_id" TEXT,
ADD COLUMN     "vat_ngn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "wht_token_amount" DECIMAL(38,0) NOT NULL DEFAULT 0,
ALTER COLUMN "usdc_asset_id" DROP NOT NULL,
ALTER COLUMN "usdc_amount" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "cashout_requests" ADD CONSTRAINT "cashout_requests_usdc_asset_id_fkey" FOREIGN KEY ("usdc_asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
