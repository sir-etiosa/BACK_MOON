/*
  Warnings:

  - You are about to drop the column `tax_id` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `tax_id_verified_at` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "tax_id",
DROP COLUMN "tax_id_verified_at";
