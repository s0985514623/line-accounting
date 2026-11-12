/**
 * 共用狀態 Then（aggregate-then）：T4、T5、T9。
 * 直接以原生 SQL 讀取資料庫最終狀態（依 id 排序）；只比對 Data Table 出現的欄位。
 * 文字必須與 specs/features/**.feature 逐字一致（含全形「：」）。
 *
 * 執行：npx cucumber-js [specs/features/<domain>]    乾跑：npm run test:bdd:dry
 */
import { DataTable, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { assertSameRows } from '../../support/assertions';
import { queryRows } from '../../support/db';
import { canonFromDb, canonFromExpected } from '../../support/table-mappers';
import type { TestWorld } from '../../support/world';

const SQL_TRANSACTIONS =
  'SELECT t.id, t.ledger::text AS ledger, t.entry_type::text AS entry_type, t.item, t.amount, ' +
  'c.name AS category, t.occurred_on::text AS occurred_on, t.note, t.source::text AS source ' +
  'FROM transactions t JOIN categories c ON c.id = t.category_id ORDER BY t.id';

const SQL_CATEGORIES =
  'SELECT id, ledger::text AS ledger, entry_type::text AS entry_type, name, is_fallback ' +
  'FROM categories ORDER BY id';

const SQL_KEYWORDS =
  'SELECT k.id, k.ledger::text AS ledger, k.entry_type::text AS entry_type, k.keyword, ' +
  'c.name AS category FROM category_keywords k JOIN categories c ON c.id = k.category_id ORDER BY k.id';

async function assertTableState(
  world: TestWorld,
  title: string,
  sql: string,
  table: DataTable,
): Promise<void> {
  const headers = table.raw()[0] ?? [];
  const expected = table.hashes().map((row) => canonFromExpected(headers, row));
  const dbRows = await queryRows<Record<string, unknown>>(world.prisma, sql);
  const actual = dbRows.map((row) => canonFromDb(headers, row));
  assertSameRows(title, actual, expected);
}

async function assertEmpty(world: TestWorld, title: string, sql: string): Promise<void> {
  const dbRows = await queryRows<Record<string, unknown>>(world.prisma, sql);
  assert.equal(
    dbRows.length,
    0,
    `${title}應為空，實際 ${dbRows.length} 筆：${JSON.stringify(dbRows)}`,
  );
}

// T4：記帳紀錄（有 id 欄才比 id；空備註 = null）
Then('記帳紀錄應為：', async function (this: TestWorld, table: DataTable) {
  await assertTableState(this, '記帳紀錄', SQL_TRANSACTIONS, table);
});

Then('記帳紀錄應為空', async function (this: TestWorld) {
  await assertEmpty(this, '記帳紀錄', SQL_TRANSACTIONS);
});

// T5：分類完全比對（依 id 排序）
Then('分類應為：', async function (this: TestWorld, table: DataTable) {
  await assertTableState(this, '分類', SQL_CATEGORIES, table);
});

Then('分類應為空', async function (this: TestWorld) {
  await assertEmpty(this, '分類', SQL_CATEGORIES);
});

// T9：分類關鍵字（分類以名稱呈現）
Then('分類關鍵字應為：', async function (this: TestWorld, table: DataTable) {
  await assertTableState(this, '分類關鍵字', SQL_KEYWORDS, table);
});

Then('分類關鍵字應為空', async function (this: TestWorld) {
  await assertEmpty(this, '分類關鍵字', SQL_KEYWORDS);
});
