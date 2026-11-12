/**
 * category 領域專用 step：W7（查詢分類列表）、W8（新增分類）、W9（刪除分類）、T11（分類應包含）。
 * 文字必須與 specs/features/category/*.feature 逐字一致（含全形「：」）。
 *
 * W7–W9 只負責送出請求並把回應存進 world.lastResponse（不做斷言；斷言交給 T2/T3/T10/T5/T11…）。
 * 身分來自 G7（world.liffIdentity → Authorization: Bearer）。
 *
 * 執行：npx cucumber-js specs/features/category    乾跑：npx cucumber-js specs/features/category --dry-run
 */
import assert from 'node:assert/strict';
import { DataTable, Then, When } from '@cucumber/cucumber';
import { queryRows } from '../../support/db';
import {
  canonFromDb,
  canonFromExpected,
  describeRows,
  rowToLiffBody,
  rowToLiffQuery,
  type Canon,
} from '../../support/table-mappers';
import type { TestWorld } from '../../support/world';

const SQL_CATEGORIES =
  'SELECT id, ledger::text AS ledger, entry_type::text AS entry_type, name, is_fallback ' +
  'FROM categories ORDER BY id';

/** 取 Data Table 的第一列資料（W7、W8 的參數表只有一列）。 */
function singleRow(table: DataTable): Record<string, string> {
  const rows = table.hashes();
  assert.equal(rows.length, 1, `參數表必須恰好 1 列，實際 ${rows.length} 列`);
  return rows[0] as Record<string, string>;
}

// W7（query）：GET /api/categories?ledger=&entryType=（空白儲存格不帶 query param）
When('記帳者以 LIFF 查詢分類列表：', async function (this: TestWorld, table: DataTable) {
  const http = await this.http();
  this.lastResponse = await http
    .get('/api/categories')
    .set(this.liffAuthHeaders())
    .query(rowToLiffQuery(singleRow(table)));
});

// W8（command）：POST /api/categories，JSON body（空白儲存格省略該欄位；`"  "` → 兩個空白）
When('記帳者以 LIFF 新增分類：', async function (this: TestWorld, table: DataTable) {
  const http = await this.http();
  this.lastResponse = await http
    .post('/api/categories')
    .set(this.liffAuthHeaders())
    .send(rowToLiffBody(singleRow(table)));
});

// W9（command）：DELETE /api/categories/{id}
When('記帳者以 LIFF 刪除分類 {int}', async function (this: TestWorld, id: number) {
  const http = await this.http();
  this.lastResponse = await http.delete(`/api/categories/${id}`).set(this.liffAuthHeaders());
});

// T11（aggregate-then，部分比對）：預期的每一列都必須存在於 categories（不要求完全相等，也不比 id 以外未列出的欄位）
Then('分類應包含：', async function (this: TestWorld, table: DataTable) {
  const headers = table.raw()[0] ?? [];
  const expected = table.hashes().map((row) => canonFromExpected(headers, row));
  const dbRows = await queryRows<Record<string, unknown>>(this.prisma, SQL_CATEGORIES);
  const actual: Canon[] = dbRows.map((row) => canonFromDb(headers, row));

  // 每個預期列各消耗一筆實際列（避免兩個相同預期列只由一筆實際列滿足）
  const remaining = [...actual];
  const missing: Canon[] = [];
  for (const want of expected) {
    const index = remaining.findIndex((candidate) =>
      headers.every((header) => candidate[header] === want[header]),
    );
    if (index === -1) missing.push(want);
    else remaining.splice(index, 1);
  }
  assert.equal(
    missing.length,
    0,
    `分類缺少預期列\n--- 缺少 ---\n${describeRows(missing)}\n--- 實際 ---\n${describeRows(actual)}`,
  );
});
