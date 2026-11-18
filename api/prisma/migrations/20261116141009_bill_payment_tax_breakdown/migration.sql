-- AlterTable
ALTER TABLE "bill_payment_requests" ADD COLUMN     "fee_ngn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tax_transaction_id" TEXT,
ADD COLUMN     "vat_ngn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "wht_token_amount" DECIMAL(38,0) NOT NULL DEFAULT 0;
