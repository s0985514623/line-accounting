/**
 * DB 測試：migration 與資料庫層約束（prisma migrate deploy 後以原生 SQL 驗證）
 *
 * 執行：TEST_DATABASE_URL=postgresql://test:test@localhost:5433/test npx vitest run tests/db
 *       （未提供 TEST_DATABASE_URL 時自動改用 Testcontainers；需 Docker）
 *
 * 隔離：每個測試檔使用獨立的 PostgreSQL schema（連線字串 ?schema=…），結束後 DROP；
 *       不影響 BDD 使用的 public schema。
 * 依據：specs/entity/erm.dbml、implementation-plan P0-3 與風險 R12（partial unique index、CHECK）。
 */
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireTestDatabase,
  createPrismaClient,
  insertRows,
  queryRows,
  runMigrateDeploy,
  sqlLiteral,
  truncateAll,
  withSchema,
  type TestDatabase,
} from '../bdd/support/db';

let database: TestDatabase;
let admin: PrismaClient;
let prisma: PrismaClient;
let schemaName: string;
let schemaUrl: string;

beforeAll(async () => {
  database = await acquireTestDatabase();
  schemaName = `t_${randomBytes(6).toString('hex')}`;
  schemaUrl = withSchema(database.url, schemaName);
  // 先 migrate（缺 schema.prisma / migration 時在此失敗），再建立連線
  runMigrateDeploy(schemaUrl);
  admin = createPrismaClient(database.url);
  prisma = createPrismaClient(schemaUrl);
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (admin) {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.$disconnect();
  }
  await database?.stop();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

async function category(
  overrides: Partial<{
    ledger: string;
    entry_type: string;
    name: string;
    is_fallback: boolean;
  }> = {},
): Promise<number> {
  const row = {
    ledger: 'personal',
    entry_type: 'expense',
    name: '餐飲',
    is_fallback: false,
    ...overrides,
  };
  await insertRows(prisma, 'categories', [row]);
  const found = await queryRows<{ id: number }>(
    prisma,
    `SELECT id FROM categories WHERE ledger = ${sqlLiteral(row.ledger)} ` +
      `AND entry_type = ${sqlLiteral(row.entry_type)} AND name = ${sqlLiteral(row.name)}`,
  );
  return (found[0] as { id: number }).id;
}

async function transaction(categoryId: number, amount = 120): Promise<number> {
  await insertRows(prisma, 'transactions', [
    {
      ledger: 'personal',
      entry_type: 'expense',
      item: '午餐',
      amount,
      category_id: categoryId,
      occurred_on: '2026-11-12',
      note: null,
      source: 'line_text',
    },
  ]);
  const found = await queryRows<{ id: number }>(
    prisma,
    'SELECT id FROM transactions ORDER BY id DESC LIMIT 1',
  );
  return (found[0] as { id: number }).id;
}

async function count(table: string, where = 'TRUE'): Promise<number> {
  const rows = await queryRows<{ n: number }>(
    prisma,
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${where}`,
  );
  return (rows[0] as { n: number }).n;
}

describe('[Smoke] migration', () => {
  it('四張資料表都已建立', async () => {
    const rows = await queryRows<{ table_name: string }>(
      prisma,
      `SELECT table_name FROM information_schema.tables WHERE table_schema = ${sqlLiteral(schemaName)}`,
    );
    const names = rows.map((r) => r.table_name);
    for (const table of ['categories', 'category_keywords', 'transactions', 'postback_tokens']) {
      expect(names).toContain(table);
    }
  });

  it('migrate deploy 可重複執行（部署流程每次都會跑；第二次為 no-op）', () => {
    expect(() => runMigrateDeploy(schemaUrl)).not.toThrow();
  });
});

describe('[Error] categories：每個「帳本 × 收支」恰一個「其他」（partial unique index，R12）', () => {
  it('同帳本同收支第二個 is_fallback=true 失敗', async () => {
    await category({ name: '其他', is_fallback: true });
    await expect(category({ name: '雜項', is_fallback: true })).rejects.toThrow();
    expect(await count('categories', 'is_fallback')).toBe(1);
  });

  it('對照組：同帳本同收支可有任意多個非「其他」分類（索引是 partial，不是全表 unique）', async () => {
    await category({ name: '餐飲' });
    await category({ name: '交通' });
    await category({ name: '購物' });
    expect(await count('categories')).toBe(3);
  });

  it('對照組：不同帳本或不同收支各自可有一個「其他」', async () => {
    await category({ ledger: 'personal', entry_type: 'expense', name: '其他', is_fallback: true });
    await category({ ledger: 'personal', entry_type: 'income', name: '其他', is_fallback: true });
    await category({ ledger: 'company', entry_type: 'expense', name: '其他', is_fallback: true });
    await category({ ledger: 'company', entry_type: 'income', name: '其他', is_fallback: true });
    expect(await count('categories', 'is_fallback')).toBe(4);
  });

  it('同帳本同收支分類名稱重複失敗（unique ledger, entry_type, name）', async () => {
    await category({ name: '餐飲' });
    await expect(category({ name: '餐飲' })).rejects.toThrow();
  });

  it('對照組：同名但不同帳本 / 不同收支可並存', async () => {
    await category({ ledger: 'personal', entry_type: 'expense', name: '交通' });
    await category({ ledger: 'company', entry_type: 'expense', name: '交通' });
    await category({ ledger: 'personal', entry_type: 'income', name: '交通' });
    expect(await count('categories')).toBe(3);
  });

  it('不合法的 ledger / entry_type enum 值被拒絕', async () => {
    await expect(category({ ledger: 'household' })).rejects.toThrow();
    await expect(category({ entry_type: 'transfer' })).rejects.toThrow();
  });
});

describe('[Error] transactions：金額必須 > 0（CHECK）', () => {
  it.each([0, -1, -120])('amount=%i 違反 CHECK', async (amount) => {
    const categoryId = await category();
    await expect(transaction(categoryId, amount)).rejects.toThrow();
    expect(await count('transactions')).toBe(0);
  });

  it('[Edge] amount=1（最小合法值）可寫入', async () => {
    const categoryId = await category();
    await transaction(categoryId, 1);
    expect(await count('transactions')).toBe(1);
  });

  it('參照不存在的分類被拒絕（外鍵）', async () => {
    await expect(transaction(99999)).rejects.toThrow();
  });
});

describe('[Happy] 連動刪除（ON DELETE）', () => {
  it('刪除分類 → 該分類的關鍵字一併刪除（CASCADE），其他分類的關鍵字不受影響', async () => {
    const pets = await category({ name: '寵物' });
    const food = await category({ name: '餐飲' });
    await insertRows(prisma, 'category_keywords', [
      { category_id: pets, ledger: 'personal', entry_type: 'expense', keyword: '飼料' },
      { category_id: pets, ledger: 'personal', entry_type: 'expense', keyword: '貓砂' },
      { category_id: food, ledger: 'personal', entry_type: 'expense', keyword: '午餐' },
    ]);

    await prisma.$executeRawUnsafe(`DELETE FROM categories WHERE id = ${pets}`);

    expect(await count('category_keywords', `category_id = ${pets}`)).toBe(0);
    expect(await count('category_keywords', `category_id = ${food}`)).toBe(1);
  });

  it('刪除記帳紀錄 → postback_tokens.transaction_id 變 NULL，token 列仍保留（視為已使用）', async () => {
    const categoryId = await category();
    const transactionId = await transaction(categoryId);
    await insertRows(prisma, 'postback_tokens', [{ token: 'tk1', transaction_id: transactionId }]);

    await prisma.$executeRawUnsafe(`DELETE FROM transactions WHERE id = ${transactionId}`);

    const tokens = await queryRows<{ token: string; transaction_id: number | null }>(
      prisma,
      'SELECT token, transaction_id FROM postback_tokens',
    );
    expect(tokens).toEqual([{ token: 'tk1', transaction_id: null }]);
  });
});

describe('[Error] 其他唯一性與主鍵', () => {
  it('同一 postback token 不可重複寫入（PK）：雙擊分類按鈕只會記一筆', async () => {
    await insertRows(prisma, 'postback_tokens', [{ token: 'tk1', transaction_id: null }]);
    await expect(
      insertRows(prisma, 'postback_tokens', [{ token: 'tk1', transaction_id: null }]),
    ).rejects.toThrow();
  });

  it('同帳本同收支的關鍵字重複失敗（unique ledger, entry_type, keyword）', async () => {
    const food = await category({ name: '餐飲' });
    const transport = await category({ name: '交通' });
    await insertRows(prisma, 'category_keywords', [
      { category_id: food, ledger: 'personal', entry_type: 'expense', keyword: '午餐' },
    ]);
    await expect(
      insertRows(prisma, 'category_keywords', [
        { category_id: transport, ledger: 'personal', entry_type: 'expense', keyword: '午餐' },
      ]),
    ).rejects.toThrow();
  });

  it('[Edge] 項目 / 分類名稱 / 關鍵字超過 50 字被資料庫拒絕（varchar(50)）', async () => {
    const longText = '長'.repeat(51);
    await expect(category({ name: longText })).rejects.toThrow();
    const categoryId = await category({ name: '餐飲' });
    await expect(
      insertRows(prisma, 'transactions', [
        {
          ledger: 'personal',
          entry_type: 'expense',
          item: longText,
          amount: 10,
          category_id: categoryId,
          occurred_on: '2026-11-12',
          note: null,
          source: 'line_text',
        },
      ]),
    ).rejects.toThrow();
  });

  it('[Edge] 恰 50 字可寫入（含全形字元，以字元數而非位元組計）', async () => {
    await category({ name: '長'.repeat(50) });
    expect(await count('categories')).toBe(1);
  });
});
