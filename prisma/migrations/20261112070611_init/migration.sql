-- CreateEnum
CREATE TYPE "ledger" AS ENUM ('personal', 'company');

-- CreateEnum
CREATE TYPE "entry_type" AS ENUM ('expense', 'income');

-- CreateEnum
CREATE TYPE "entry_source" AS ENUM ('line_text', 'liff_form');

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "ledger" "ledger" NOT NULL,
    "entry_type" "entry_type" NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "is_fallback" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_keywords" (
    "id" SERIAL NOT NULL,
    "category_id" INTEGER NOT NULL,
    "ledger" "ledger" NOT NULL,
    "entry_type" "entry_type" NOT NULL,
    "keyword" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" SERIAL NOT NULL,
    "ledger" "ledger" NOT NULL,
    "entry_type" "entry_type" NOT NULL,
    "item" VARCHAR(50) NOT NULL,
    "amount" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "occurred_on" DATE NOT NULL,
    "note" TEXT,
    "source" "entry_source" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "postback_tokens" (
    "token" VARCHAR(64) NOT NULL,
    "transaction_id" INTEGER,
    "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "postback_tokens_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_ledger_entry_type_name_key" ON "categories"("ledger", "entry_type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "category_keywords_ledger_entry_type_keyword_key" ON "category_keywords"("ledger", "entry_type", "keyword");

-- CreateIndex
CREATE INDEX "transactions_ledger_occurred_on_idx" ON "transactions"("ledger", "occurred_on");

-- CreateIndex
CREATE INDEX "transactions_category_id_idx" ON "transactions"("category_id");

-- AddForeignKey
ALTER TABLE "category_keywords" ADD CONSTRAINT "category_keywords_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postback_tokens" ADD CONSTRAINT "postback_tokens_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 手動追加：Prisma schema 無法表達的約束（implementation-plan P0-3、R12）
-- 注意：之後執行 `prisma migrate dev` 若產生 DROP INDEX "categories_one_fallback"，
--       必須從新 migration 中移除該行（Prisma 不認得 partial index）。
-- ---------------------------------------------------------------------------

-- 每個 ledger × entry_type 恰一個「其他」分類
CREATE UNIQUE INDEX "categories_one_fallback" ON "categories"("ledger", "entry_type") WHERE "is_fallback";

-- 金額必須為正整數
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_positive" CHECK ("amount" > 0);
