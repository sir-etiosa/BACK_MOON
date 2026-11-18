/*
  Warnings:

  - Added the required column `tax_type` to the `tax_sweeps` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "tax_sweeps" ADD COLUMN     "tax_type" "TaxType" NOT NULL;

-- CreateIndex
CREATE INDEX "tax_sweeps_tax_type_asset_id_status_idx" ON "tax_sweeps"("tax_type", "asset_id", "status");
