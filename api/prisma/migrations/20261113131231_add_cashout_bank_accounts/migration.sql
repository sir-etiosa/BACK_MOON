-- CreateTable
CREATE TABLE "cashout_bank_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cashout_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cashout_bank_accounts_user_id_idx" ON "cashout_bank_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cashout_bank_accounts_user_id_bank_name_account_number_key" ON "cashout_bank_accounts"("user_id", "bank_name", "account_number");

-- AddForeignKey
ALTER TABLE "cashout_bank_accounts" ADD CONSTRAINT "cashout_bank_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
