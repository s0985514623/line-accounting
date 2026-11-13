-- CreateEnum
CREATE TYPE "recurring_occurrence_status" AS ENUM ('pending', 'confirmed', 'skipped');

-- CreateTable
CREATE TABLE "recurring_entries" (
    "id" SERIAL NOT NULL,
    "ledger" "ledger" NOT NULL,
    "entry_type" "entry_type" NOT NULL,
    "item" VARCHAR(50) NOT NULL,
    "amount" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "day_of_month" INTEGER NOT NULL,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "next_due_on" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_occurrences" (
    "id" SERIAL NOT NULL,
    "recurring_entry_id" INTEGER NOT NULL,
    "due_on" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "recurring_occurrence_status" NOT NULL DEFAULT 'pending',
    "transaction_id" INTEGER,
    "notified_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_entries_active_next_due_on_idx" ON "recurring_entries"("active", "next_due_on");

-- CreateIndex
CREATE INDEX "recurring_occurrences_status_due_on_idx" ON "recurring_occurrences"("status", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_occurrences_recurring_entry_id_due_on_key" ON "recurring_occurrences"("recurring_entry_id", "due_on");

-- AddForeignKey
ALTER TABLE "recurring_entries" ADD CONSTRAINT "recurring_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_recurring_entry_id_fkey" FOREIGN KEY ("recurring_entry_id") REFERENCES "recurring_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 手動追加（Prisma 無法表達的 CHECK）
ALTER TABLE "recurring_entries" ADD CONSTRAINT "recurring_entries_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "recurring_entries" ADD CONSTRAINT "recurring_entries_day_of_month_range" CHECK ("day_of_month" BETWEEN 1 AND 31);
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_amount_positive" CHECK ("amount" > 0);
