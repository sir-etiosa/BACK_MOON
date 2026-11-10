-- CreateTable
CREATE TABLE "asset_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_name" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_requests_user_id_created_at_idx" ON "asset_requests"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
