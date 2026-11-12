/**
 * 共用 Given（aggregate-given）：G1–G7。
 * 文字必須與 specs/features/**.feature 逐字一致（含全形「：」）。
 *
 * 執行：npx cucumber-js [specs/features/<domain>]    乾跑：npm run test:bdd:dry
 */
import { DataTable, Given } from '@cucumber/cucumber';
import { findCategoryId, insertWithIds } from '../../support/db';
import {
  emptyToNull,
  mapEntryType,
  mapFallback,
  mapLedger,
  mapSource,
  unquote,
} from '../../support/table-mappers';
import type { TestWorld } from '../../support/world';

// G1：白名單 userId（設定）。變更後 app 於下次使用時重建。
Given('白名單 LINE userId 為 {string}', function (this: TestWorld, userId: string) {
  this.setOwnerUserId(userId);
});

// G2：固定時鐘（台北當日中午）
Given('今天為 {string}', function (this: TestWorld, date: string) {
  this.clock.set(date);
});

// G3：分類。有 id 欄位 → 指定 id；其他分類 → is_fallback
Given('系統中有以下分類：', async function (this: TestWorld, table: DataTable) {
  const rows = table.hashes().map((row) => {
    const record: Record<string, string | number | boolean | null> = {
      ledger: mapLedger(row['帳本'] ?? ''),
      entry_type: mapEntryType(row['收支'] ?? ''),
      name: unquote(row['名稱'] ?? ''),
      is_fallback: mapFallback(row['其他分類'] ?? '否') === 'true',
    };
    if (row['id'] !== undefined && row['id'] !== '') {
      return { id: Number(row['id']), ...record };
    }
    return record;
  });
  await insertWithIds(this.prisma, 'categories', rows);
});

// G4：記帳紀錄。分類名稱依該列的帳本、收支解析為 id
Given('系統中有以下記帳紀錄：', async function (this: TestWorld, table: DataTable) {
  const rows: Array<Record<string, string | number | boolean | null>> = [];
  for (const row of table.hashes()) {
    const ledger = mapLedger(row['帳本'] ?? '');
    const entryType = mapEntryType(row['收支'] ?? '');
    const categoryId = await findCategoryId(
      this.prisma,
      ledger,
      entryType,
      unquote(row['分類'] ?? ''),
    );
    const record: Record<string, string | number | boolean | null> = {
      ledger,
      entry_type: entryType,
      item: unquote(row['項目'] ?? ''),
      amount: Number(row['金額']),
      category_id: categoryId,
      occurred_on: row['日期'] ?? '',
      note: emptyToNull(row['備註']),
      source: mapSource(row['來源'] ?? ''),
    };
    rows.push(row['id'] ? { id: Number(row['id']), ...record } : record);
  }
  await insertWithIds(this.prisma, 'transactions', rows);
});

// G5：分類關鍵字（冗餘 ledger / entry_type 一併寫入）
Given('系統中有以下分類關鍵字：', async function (this: TestWorld, table: DataTable) {
  const rows: Array<Record<string, string | number | boolean | null>> = [];
  for (const row of table.hashes()) {
    const ledger = mapLedger(row['帳本'] ?? '');
    const entryType = mapEntryType(row['收支'] ?? '');
    const categoryId = await findCategoryId(
      this.prisma,
      ledger,
      entryType,
      unquote(row['分類'] ?? ''),
    );
    rows.push({
      category_id: categoryId,
      ledger,
      entry_type: entryType,
      keyword: unquote(row['關鍵字'] ?? ''),
    });
  }
  await insertWithIds(this.prisma, 'category_keywords', rows);
});

// G6：已使用的分類按鈕 token（transaction_id = null）
Given('系統中有以下已使用的分類按鈕 token：', async function (this: TestWorld, table: DataTable) {
  const rows = table.hashes().map((row) => ({
    token: unquote(row['token'] ?? ''),
    transaction_id: null,
  }));
  await insertWithIds(this.prisma, 'postback_tokens', rows);
});

// G7：LIFF 請求身分（auth stub；(無效token) 代表驗證失敗）
Given('LIFF 請求身分為 {string}', function (this: TestWorld, identity: string) {
  this.liffIdentity = identity;
});
