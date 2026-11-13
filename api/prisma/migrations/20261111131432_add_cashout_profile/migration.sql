-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'CASHOUT';

-- CreateTable
CREATE TABLE "cashout_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "last_name" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "bank_name" TEXT,
    "account_number" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashout_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cashout_profiles_user_id_key" ON "cashout_profiles"("user_id");

-- AddForeignKey
ALTER TABLE "cashout_profiles" ADD CONSTRAINT "cashout_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
