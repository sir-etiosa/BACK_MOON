-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('NON_STABLE', 'STABLECOIN');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('USER_ASSET', 'TREASURY', 'HOT_WALLET', 'TAX_WALLET', 'REVENUE_FEES', 'TAX_WHT', 'TAX_VAT', 'TAX_STAMP', 'PAYOUT_CLEARING', 'BILLS_CLEARING', 'BANK_PAYOUT', 'BILLER_SETTLEMENT', 'NRS_REMITTED', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('WHT', 'VAT', 'STAMP');

-- CreateEnum
CREATE TYPE "PostingRefType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'SWAP', 'CASHOUT', 'BILL_PAYMENT', 'TAX_WHT', 'TAX_VAT', 'TAX_STAMP', 'FEE', 'SWEEP', 'REMITTANCE', 'REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TaxEventType" AS ENUM ('SWAP', 'CASHOUT', 'BILL_PAYMENT');

-- CreateEnum
CREATE TYPE "RuleBase" AS ENUM ('GROSS', 'FEE', 'PER_TXN');

-- CreateEnum
CREATE TYPE "CollectIn" AS ENUM ('SOURCE_TOKEN', 'FEE_CURRENCY', 'NGN');

-- CreateEnum
CREATE TYPE "FeeChargeType" AS ENUM ('PERCENT', 'FLAT');

-- CreateEnum
CREATE TYPE "TaxQuoteStatus" AS ENUM ('OPEN', 'EXPIRED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "TaxTransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "SweepStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RemittanceStatus" AS ENUM ('PENDING', 'PAID');

-- CreateEnum
CREATE TYPE "BillPaymentStatus" AS ENUM ('PENDING', 'PAID', 'REJECTED');

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "category" "AssetCategory" NOT NULL DEFAULT 'NON_STABLE';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "tax_id" TEXT,
ADD COLUMN     "tax_id_verified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "asset_id" TEXT NOT NULL,
    "user_id" TEXT,
    "tax_type" "TaxType",
    "allow_negative" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_account_balances" (
    "ledger_account_id" TEXT NOT NULL,
    "balance" DECIMAL(38,0) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_account_balances_pkey" PRIMARY KEY ("ledger_account_id")
);

-- CreateTable
CREATE TABLE "ledger_account_entries" (
    "id" TEXT NOT NULL,
    "ledger_account_id" TEXT NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount" DECIMAL(38,0) NOT NULL,
    "ref_type" "PostingRefType" NOT NULL,
    "ref_id" TEXT NOT NULL,
    "balance_after" DECIMAL(38,0) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_account_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "postings" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT,
    "leg_index" INTEGER NOT NULL,
    "from_account_id" TEXT NOT NULL,
    "to_account_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "amount" DECIMAL(38,0) NOT NULL,
    "ref_type" "PostingRefType" NOT NULL,
    "ref_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rules" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "tax_type" "TaxType" NOT NULL,
    "event_type" "TaxEventType" NOT NULL,
    "asset_category" "AssetCategory",
    "rate_bps" INTEGER,
    "flat_amount_minor" DECIMAL(38,0),
    "flat_currency_asset_id" TEXT,
    "base" "RuleBase" NOT NULL,
    "collect_in" "CollectIn" NOT NULL,
    "threshold_minor" DECIMAL(38,0),
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_by_admin_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_rules" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "event_type" "TaxEventType" NOT NULL,
    "asset_id" TEXT,
    "type" "FeeChargeType" NOT NULL,
    "rate_bps" INTEGER,
    "flat_amount_minor" DECIMAL(38,0),
    "charge_in" "CollectIn" NOT NULL,
    "base" "RuleBase" NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_by_admin_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_snapshots" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "usd_price" DECIMAL(24,8) NOT NULL,
    "usd_ngn_rate" DECIMAL(18,4) NOT NULL,
    "source" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_quotes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_type" "TaxEventType" NOT NULL,
    "inputs_json" JSONB NOT NULL,
    "breakdown_json" JSONB NOT NULL,
    "rule_versions_json" JSONB NOT NULL,
    "price_snapshot_id" TEXT NOT NULL,
    "status" "TaxQuoteStatus" NOT NULL DEFAULT 'OPEN',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_transactions" (
    "id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_type" "TaxEventType" NOT NULL,
    "status" "TaxTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" TEXT NOT NULL,
    "external_ref" TEXT,
    "reversed_by_transaction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_events" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "asset_symbol" TEXT NOT NULL,
    "quantity_minor" DECIMAL(38,0) NOT NULL,
    "gross_usd_value" DECIMAL(24,8) NOT NULL,
    "price_snapshot_id" TEXT NOT NULL,
    "wht_token_minor" DECIMAL(38,0) NOT NULL DEFAULT 0,
    "wht_ngn_value_kobo" DECIMAL(38,0) NOT NULL DEFAULT 0,
    "fee_amount_minor" DECIMAL(38,0) NOT NULL DEFAULT 0,
    "fee_currency_asset_id" TEXT,
    "vat_amount_minor" DECIMAL(38,0) NOT NULL DEFAULT 0,
    "vat_currency_asset_id" TEXT,
    "stamp_amount_kobo" DECIMAL(38,0) NOT NULL DEFAULT 0,
    "rule_versions_json" JSONB NOT NULL,
    "counterparty_ref" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acquisition_lots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "quantity_minor" DECIMAL(38,0) NOT NULL,
    "usd_cost_base" DECIMAL(24,8) NOT NULL,
    "acquired_at" TIMESTAMP(3) NOT NULL,
    "source_transaction_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "acquisition_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_wallets" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "address_or_account" TEXT NOT NULL,
    "custody_provider" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_sweeps" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "amount_minor" DECIMAL(38,0) NOT NULL,
    "tx_hash_or_ref" TEXT,
    "covered_posting_ids" JSONB NOT NULL,
    "status" "SweepStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_sweeps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_remittances" (
    "id" TEXT NOT NULL,
    "tax_type" "TaxType" NOT NULL,
    "asset_id" TEXT NOT NULL,
    "amount_minor" DECIMAL(38,0) NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "tx_hash_or_ref" TEXT,
    "nrs_receipt_ref" TEXT,
    "document_url" TEXT,
    "status" "RemittanceStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_admin_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_remittances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_reconciliation_runs" (
    "id" TEXT NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "results_json" JSONB NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "tax_reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before_json" JSONB,
    "after_json" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payment_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "sold_token_amount" DECIMAL(38,0) NOT NULL,
    "bill_amount_ngn" DECIMAL(18,2) NOT NULL,
    "biller_category" TEXT NOT NULL,
    "biller_ref" TEXT,
    "status" "BillPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "processed_by_admin_id" TEXT,
    "processed_at" TIMESTAMP(3),
    "notes" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");

-- CreateIndex
CREATE INDEX "ledger_accounts_user_id_asset_id_idx" ON "ledger_accounts"("user_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_type_asset_id_user_id_tax_type_key" ON "ledger_accounts"("type", "asset_id", "user_id", "tax_type");

-- CreateIndex
CREATE INDEX "ledger_account_entries_ledger_account_id_idx" ON "ledger_account_entries"("ledger_account_id");

-- CreateIndex
CREATE INDEX "ledger_account_entries_ref_type_ref_id_idx" ON "ledger_account_entries"("ref_type", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_account_entries_ref_type_ref_id_ledger_account_id_di_key" ON "ledger_account_entries"("ref_type", "ref_id", "ledger_account_id", "direction");

-- CreateIndex
CREATE INDEX "postings_from_account_id_asset_id_idx" ON "postings"("from_account_id", "asset_id");

-- CreateIndex
CREATE INDEX "postings_to_account_id_asset_id_idx" ON "postings"("to_account_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "postings_transaction_id_leg_index_key" ON "postings"("transaction_id", "leg_index");

-- CreateIndex
CREATE INDEX "tax_rules_tax_type_event_type_asset_category_effective_from_idx" ON "tax_rules"("tax_type", "event_type", "asset_category", "effective_from");

-- CreateIndex
CREATE INDEX "fee_rules_event_type_asset_id_effective_from_idx" ON "fee_rules"("event_type", "asset_id", "effective_from");

-- CreateIndex
CREATE INDEX "price_snapshots_asset_id_captured_at_idx" ON "price_snapshots"("asset_id", "captured_at");

-- CreateIndex
CREATE INDEX "tax_quotes_user_id_status_idx" ON "tax_quotes"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tax_transactions_quote_id_key" ON "tax_transactions"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_transactions_idempotency_key_key" ON "tax_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "tax_events_user_id_created_at_idx" ON "tax_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "acquisition_lots_user_id_asset_id_acquired_at_idx" ON "acquisition_lots"("user_id", "asset_id", "acquired_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "bill_payment_requests_status_idx" ON "bill_payment_requests"("status");

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_account_balances" ADD CONSTRAINT "ledger_account_balances_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_account_entries" ADD CONSTRAINT "ledger_account_entries_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "tax_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_quotes" ADD CONSTRAINT "tax_quotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "tax_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_events" ADD CONSTRAINT "tax_events_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "tax_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_events" ADD CONSTRAINT "tax_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acquisition_lots" ADD CONSTRAINT "acquisition_lots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acquisition_lots" ADD CONSTRAINT "acquisition_lots_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_wallets" ADD CONSTRAINT "tax_wallets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_sweeps" ADD CONSTRAINT "tax_sweeps_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_remittances" ADD CONSTRAINT "tax_remittances_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payment_requests" ADD CONSTRAINT "bill_payment_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payment_requests" ADD CONSTRAINT "bill_payment_requests_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
