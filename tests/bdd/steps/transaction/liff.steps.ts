/**
 * transaction 領域的 LIFF 請求 step：W3（新增）、W4（編輯）、W5（刪除）、W6（查詢列表）。
 * 文字必須與 specs/features/transaction/{以表單記帳,編輯記帳紀錄,刪除記帳紀錄,查詢記帳紀錄列表}.feature 逐字一致（含全形「：」）。
 *
 * 四個 step 只負責送出請求並把回應存進 world.lastResponse（不做斷言；斷言交給 T2/T3/T4/T10）。
 * 身分來自 G7（world.liffIdentity → Authorization: Bearer）。
 * 欄位對映：分類id → categoryId、日期 → occurredOn、月份 → month（見 support/table-mappers.ts 的 rowToLiffBody / rowToLiffQuery）。
 *   - W3/W4：空白儲存格 → 省略該欄位（備註空白 → null）；金額 12.5 送 12.5、0 送 0、-1 送 -1。
 *   - W6：空白儲存格 → 不帶該 query param。
 *
 * 執行：npx cucumber-js specs/features/transaction/以表單記帳.feature
 * 乾跑：npx cucumber-js specs/features/transaction --dry-run
 */
import assert from 'node:assert/strict';
import { DataTable, When } from '@cucumber/cucumber';
import { rowToLiffBody, rowToLiffQuery } from '../../support/table-mappers';
import type { TestWorld } from '../../support/world';

/** 取 Data Table 的第一列資料（W3、W4、W6 的參數表只有一列）。 */
function singleRow(table: DataTable): Record<string, string> {
  const rows = table.hashes();
  assert.equal(rows.length, 1, `參數表必須恰好 1 列，實際 ${rows.length} 列`);
  return rows[0] as Record<string, string>;
}

/** 成功建立時記下新紀錄 id（供 `$記帳紀錄.id` 解析）；失敗回應不處理。 */
function rememberTransactionId(world: TestWorld): void {
  const id: unknown = world.lastResponse?.body?.id;
  if (typeof id === 'number') world.lastTransactionId = id;
}

// W3（command）：POST /api/transactions
When('記帳者以 LIFF 新增記帳紀錄：', async function (this: TestWorld, table: DataTable) {
  const http = await this.http();
  this.lastResponse = await http
    .post('/api/transactions')
    .set(this.liffAuthHeaders())
    .send(rowToLiffBody(singleRow(table)));
  rememberTransactionId(this);
});

// W4（command）：PUT /api/transactions/{id}（全欄位更新）
When(
  '記帳者以 LIFF 編輯記帳紀錄 {int}：',
  async function (this: TestWorld, id: number, table: DataTable) {
    const http = await this.http();
    this.lastResponse = await http
      .put(`/api/transactions/${id}`)
      .set(this.liffAuthHeaders())
      .send(rowToLiffBody(singleRow(table)));
  },
);

// W5（command）：DELETE /api/transactions/{id}
When('記帳者以 LIFF 刪除記帳紀錄 {int}', async function (this: TestWorld, id: number) {
  const http = await this.http();
  this.lastResponse = await http.delete(`/api/transactions/${id}`).set(this.liffAuthHeaders());
});

// W6（query）：GET /api/transactions?month=&ledger=（空白儲存格不帶 query param）
When('記帳者以 LIFF 查詢記帳紀錄列表：', async function (this: TestWorld, table: DataTable) {
  const http = await this.http();
  this.lastResponse = await http
    .get('/api/transactions')
    .set(this.liffAuthHeaders())
    .query(rowToLiffQuery(singleRow(table)));
});

// W3b（command）：POST /api/transactions/batch（每列一筆）
When('記帳者以 LIFF 批次新增記帳紀錄：', async function (this: TestWorld, table: DataTable) {
  const http = await this.http();
  this.lastResponse = await http
    .post('/api/transactions/batch')
    .set(this.liffAuthHeaders())
    .send({ items: table.hashes().map((row) => rowToLiffBody(row)) });
});
