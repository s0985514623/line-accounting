-- CreateTable
CREATE TABLE "pending_entries" (
    "id" SERIAL NOT NULL,
    "batch_id" VARCHAR(64) NOT NULL,
    "seq" INTEGER NOT NULL,
    "ledger" "ledger" NOT NULL,
    "entry_type" "entry_type" NOT NULL,
    "item" VARCHAR(50) NOT NULL,
    "amount" INTEGER NOT NULL,
    "occurred_on" DATE NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_entries_batch_id_seq_idx" ON "pending_entries"("batch_id", "seq");

-- CreateIndex
CREATE INDEX "pending_entries_created_at_idx" ON "pending_entries"("created_at");

-- 與 transactions 一致：金額必須為正整數
ALTER TABLE "pending_entries" ADD CONSTRAINT "pending_entries_amount_positive" CHECK ("amount" > 0);
