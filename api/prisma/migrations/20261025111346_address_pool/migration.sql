-- CreateTable
CREATE TABLE "address_pool" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "assigned_user_id" TEXT,
    "assigned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "address_pool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "address_pool_address_key" ON "address_pool"("address");

-- CreateIndex
CREATE INDEX "address_pool_chain_assigned_user_id_idx" ON "address_pool"("chain", "assigned_user_id");
