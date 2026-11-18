-- DropForeignKey
ALTER TABLE "tax_transactions" DROP CONSTRAINT "tax_transactions_quote_id_fkey";

-- AlterTable
ALTER TABLE "tax_transactions" ALTER COLUMN "quote_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "tax_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
