/**
 * HTTP 契約測試：記帳 CRUD 與月度統計 API 的狀態碼與回應形狀須符合 specs/api/api.yml（抽查）。
 * 行為細節（排序、分類比對、佔比…）由 BDD 驗收；此檔只釘「協定層」：
 *   - 成功狀態碼：POST 201、PUT 200、DELETE 204（無 body）、GET 200
 *   - 成功 body 含 api.yml 宣告的全部必要欄位且型別正確（Transaction / MonthlyReport）
 *   - 錯誤 body 恆為 { message: 非空字串, violationType: Error enum 其中之一 }，狀態碼對照 api.yml
 *   - 失敗的寫入不得產生資料副作用
 *
 * 執行：TEST_DATABASE_URL=postgresql://test:test@localhost:5434/test npx vitest run tests/http/api-contract.test.ts
 *
 * 契約（nodejs-master 請遵循）：
 *   POST   /api/transactions        201 Transaction（source = liff_form；note 空 → null）
 *   PUT    /api/transactions/{id}   200 Transaction（source 不變）
 *   DELETE /api/transactions/{id}   204 無 body
 *   GET    /api/transactions        200 { items: Transaction[] }
 *   GET    /api/reports/monthly     200 MonthlyReport（省略參數 = 本月個人；時鐘由 deps.clock 決定）
 *   錯誤：400 INVALID_ARGUMENT / CATEGORY_MISMATCH、401 UNAUTHENTICATED、403 FORBIDDEN、404 NOT_FOUND
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertWithIds, queryRows } from '../bdd/support/db';
import { FixedClock } from '../bdd/support/stubs';
import { createWebhookHarness, type WebhookHarness } from './support/webhook-harness';

const OWNER = 'U-owner';
const AUTH = { Authorization: `Bearer ${OWNER}` };

let harness: WebhookHarness;
let app: Express;

beforeAll(async () => {
  harness = await createWebhookHarness();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  const clock = new FixedClock();
  clock.set('2026-11-12');
  app = harness.makeApp({ ownerUserId: OWNER, clock }).app;
  await insertWithIds(harness.prisma, 'categories', [
    { id: 1, ledger: 'personal', entry_type: 'expense', name: '餐飲', is_fallback: false },
    { id: 2, ledger: 'personal', entry_type: 'expense', name: '其他', is_fallback: true },
    { id: 3, ledger: 'personal', entry_type: 'income', name: '薪資', is_fallback: false },
    { id: 5, ledger: 'company', entry_type: 'expense', name: '文具', is_fallback: false },
  ]);
  await insertWithIds(harness.prisma, 'transactions', [
    {
      id: 10,
      ledger: 'personal',
      entry_type: 'expense',
      item: '午餐',
      amount: 120,
      category_id: 1,
      occurred_on: '2026-11-12',
      note: null,
      source: 'line_text',
    },
    {
      id: 11,
      ledger: 'personal',
      entry_type: 'expense',
      item: '雜支',
      amount: 100,
      category_id: 2,
      occurred_on: '2026-11-01',
      note: '備註',
      source: 'line_text',
    },
    {
      id: 12,
      ledger: 'personal',
      entry_type: 'income',
      item: '薪資',
      amount: 50000,
      category_id: 3,
      occurred_on: '2026-11-05',
      note: null,
      source: 'liff_form',
    },
  ]);
});

// ---- api.yml 讀取與形狀斷言 --------------------------------------------------------------------

/** 從 specs/api/api.yml 取出 Error.violationType 的 enum（避免測試與規格各寫一份）。 */
function violationTypesFromSpec(): string[] {
  const text = readFileSync(resolve(__dirname, '../../specs/api/api.yml'), 'utf8');
  const block = /violationType:\s*\n\s*type: string\s*\n\s*enum:\s*\n((?:\s*- [A-Z_]+\s*\n)+)/.exec(
    text,
  );
  if (!block) throw new Error('無法從 specs/api/api.yml 解析 Error.violationType enum');
  return [...(block[1] ?? '').matchAll(/- ([A-Z_]+)/g)].map((m) => m[1] as string);
}

const VIOLATION_TYPES = violationTypesFromSpec();
const UNKNOWN_ROUTE_MESSAGE = '找不到此 API';

function expectErrorShape(response: request.Response, status: number, violationType: string): void {
  expect(response.status).toBe(status);
  expect(response.headers['content-type']).toMatch(/application\/json/);
  expect(response.body).toEqual({ message: expect.any(String), violationType });
  expect(response.body.message.length).toBeGreaterThan(0);
  expect(VIOLATION_TYPES).toContain(response.body.violationType);
}

/**
 * 「資源不存在」的 404：路由必須已掛載。api.ts 對未知路徑的後備 404（訊息「找不到此 API」）
 * 不算數，否則路由尚未實作時這類測試會假綠。
 */
function expectResourceNotFound(response: request.Response): void {
  expectErrorShape(response, 404, 'NOT_FOUND');
  expect(response.body.message).not.toBe(UNKNOWN_ROUTE_MESSAGE);
}

/** components/schemas/Transaction 的必要欄位與型別。 */
function expectTransactionShape(body: unknown): void {
  expect(body).toMatchObject({
    id: expect.any(Number),
    ledger: expect.stringMatching(/^(personal|company)$/),
    entryType: expect.stringMatching(/^(expense|income)$/),
    item: expect.any(String),
    amount: expect.any(Number),
    categoryId: expect.any(Number),
    categoryName: expect.any(String),
    occurredOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    source: expect.stringMatching(/^(line_text|liff_form)$/),
  });
  const record = body as Record<string, unknown>;
  expect(Object.keys(record)).toContain('note'); // required；值可為 null
  expect(record.note === null || typeof record.note === 'string').toBe(true);
  expect(Number.isInteger(record.id)).toBe(true);
  expect(Number.isInteger(record.amount)).toBe(true);
}

const validBody = {
  ledger: 'personal',
  entryType: 'expense',
  item: '午餐',
  amount: 150,
  categoryId: 1,
  occurredOn: '2026-11-10',
  note: '',
};

async function countTransactions(): Promise<number> {
  const rows = await queryRows<{ n: bigint | number }>(
    harness.prisma,
    'SELECT COUNT(*) AS n FROM transactions',
  );
  return Number(rows[0]?.n ?? 0);
}

// ---- 成功路徑 -----------------------------------------------------------------------------

describe('[Smoke] 成功狀態碼與回應形狀', () => {
  it('POST /api/transactions → 201 Transaction（source = liff_form，空備註 → null）', async () => {
    const response = await request(app).post('/api/transactions').set(AUTH).send(validBody);

    expect(response.status).toBe(201);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expectTransactionShape(response.body);
    expect(response.body).toMatchObject({
      ledger: 'personal',
      entryType: 'expense',
      item: '午餐',
      amount: 150,
      categoryId: 1,
      categoryName: '餐飲',
      occurredOn: '2026-11-10',
      note: null,
      source: 'liff_form',
    });
    expect(await countTransactions()).toBe(4);
  });

  it('PUT /api/transactions/{id} → 200 Transaction（source 維持 line_text）', async () => {
    const response = await request(app)
      .put('/api/transactions/10')
      .set(AUTH)
      .send({ ...validBody, item: '晚餐', amount: 200, note: '更正' });

    expect(response.status).toBe(200);
    expectTransactionShape(response.body);
    expect(response.body).toMatchObject({
      id: 10,
      item: '晚餐',
      amount: 200,
      note: '更正',
      source: 'line_text',
    });
  });

  it('DELETE /api/transactions/{id} → 204 且沒有 body，紀錄被刪除', async () => {
    const response = await request(app).delete('/api/transactions/10').set(AUTH);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(await countTransactions()).toBe(2);
  });

  it('GET /api/transactions → 200 { items: Transaction[] }（日期新到舊）', async () => {
    const response = await request(app)
      .get('/api/transactions')
      .query({ month: '2026-11', ledger: 'personal' })
      .set(AUTH);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body)).toEqual(['items']);
    expect(Array.isArray(response.body.items)).toBe(true);
    expect(response.body.items).toHaveLength(3);
    for (const item of response.body.items) expectTransactionShape(item);
    expect(response.body.items.map((item: { id: number }) => item.id)).toEqual([10, 12, 11]);
  });

  it('GET /api/transactions 查無資料 → 200 { items: [] }', async () => {
    const response = await request(app)
      .get('/api/transactions')
      .query({ month: '2026-09', ledger: 'personal' })
      .set(AUTH);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
  });

  it('GET /api/reports/monthly → 200 MonthlyReport（整數合計、expenseByCategory 項目形狀）', async () => {
    const response = await request(app)
      .get('/api/reports/monthly')
      .query({ month: '2026-11', ledger: 'personal' })
      .set(AUTH);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ledger: 'personal',
      month: '2026-11',
      incomeTotal: 50000,
      expenseTotal: 220,
      balance: 49780,
    });
    expect(Array.isArray(response.body.expenseByCategory)).toBe(true);
    expect(response.body.expenseByCategory).toHaveLength(2);
    for (const entry of response.body.expenseByCategory) {
      expect(entry).toMatchObject({
        categoryName: expect.any(String),
        amount: expect.any(Number),
        ratio: expect.any(Number),
      });
      expect(Number.isInteger(entry.amount)).toBe(true);
    }
    expect(response.body.expenseByCategory[0]).toMatchObject({
      categoryName: '餐飲',
      amount: 120,
      ratio: 54.5,
    });
  });

  it('GET /api/reports/monthly 省略參數 → 本月（Asia/Taipei）個人帳本', async () => {
    const response = await request(app).get('/api/reports/monthly').set(AUTH);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ledger: 'personal', month: '2026-11' });
  });

  it('GET /api/reports/monthly 無支出 → expenseByCategory 為空陣列（非 null）', async () => {
    const response = await request(app)
      .get('/api/reports/monthly')
      .query({ month: '2026-09', ledger: 'company' })
      .set(AUTH);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      incomeTotal: 0,
      expenseTotal: 0,
      balance: 0,
      expenseByCategory: [],
    });
  });
});

// ---- 錯誤 body 形狀 -----------------------------------------------------------------------

describe('[Error] 錯誤 body 形狀與狀態碼符合 api.yml', () => {
  it('api.yml 的 violationType enum 含本 API 會用到的全部類型', () => {
    expect(VIOLATION_TYPES).toEqual(
      expect.arrayContaining([
        'UNAUTHENTICATED',
        'FORBIDDEN',
        'INVALID_ARGUMENT',
        'NOT_FOUND',
        'CATEGORY_MISMATCH',
      ]),
    );
  });

  it('POST 參數不合法 → 400 INVALID_ARGUMENT，且不建立紀錄', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .set(AUTH)
      .send({ ...validBody, occurredOn: '2026-02-30' });

    expectErrorShape(response, 400, 'INVALID_ARGUMENT');
    expect(await countTransactions()).toBe(3);
  });

  it('POST 缺少必填欄位 → 400 INVALID_ARGUMENT', async () => {
    const response = await request(app).post('/api/transactions').set(AUTH).send({});

    expectErrorShape(response, 400, 'INVALID_ARGUMENT');
  });

  it('POST 不是合法 JSON → 400 INVALID_ARGUMENT', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .set(AUTH)
      .set('Content-Type', 'application/json')
      .send('{"ledger":');

    expectErrorShape(response, 400, 'INVALID_ARGUMENT');
  });

  it('POST 分類屬於別的收支 → 400 CATEGORY_MISMATCH，且不建立紀錄', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .set(AUTH)
      .send({ ...validBody, categoryId: 3 });

    expectErrorShape(response, 400, 'CATEGORY_MISMATCH');
    expect(await countTransactions()).toBe(3);
  });

  it('POST 分類不存在 → 404 NOT_FOUND', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .set(AUTH)
      .send({ ...validBody, categoryId: 99 });

    expectResourceNotFound(response);
  });

  it('PUT 紀錄不存在 → 404 NOT_FOUND', async () => {
    const response = await request(app).put('/api/transactions/99').set(AUTH).send(validBody);

    expectResourceNotFound(response);
  });

  it('PUT 分類不符 → 400 CATEGORY_MISMATCH，且紀錄不變', async () => {
    const response = await request(app)
      .put('/api/transactions/10')
      .set(AUTH)
      .send({ ...validBody, ledger: 'company' });

    expectErrorShape(response, 400, 'CATEGORY_MISMATCH');
    const rows = await queryRows<{ item: string; amount: number; ledger: string }>(
      harness.prisma,
      'SELECT item, amount, ledger::text AS ledger FROM transactions WHERE id = 10',
    );
    expect(rows).toEqual([{ item: '午餐', amount: 120, ledger: 'personal' }]);
  });

  it('DELETE 紀錄不存在 → 404 NOT_FOUND；重複刪除第二次亦 404', async () => {
    expectResourceNotFound(await request(app).delete('/api/transactions/99').set(AUTH));

    expect((await request(app).delete('/api/transactions/10').set(AUTH)).status).toBe(204);
    expectResourceNotFound(await request(app).delete('/api/transactions/10').set(AUTH));
  });

  it('GET 列表缺 ledger 或月份不合法 → 400 INVALID_ARGUMENT', async () => {
    expectErrorShape(
      await request(app).get('/api/transactions').query({ month: '2026-11' }).set(AUTH),
      400,
      'INVALID_ARGUMENT',
    );
    expectErrorShape(
      await request(app)
        .get('/api/transactions')
        .query({ month: '2026-13', ledger: 'personal' })
        .set(AUTH),
      400,
      'INVALID_ARGUMENT',
    );
  });

  it('GET /api/reports/annual → 200 AnnualReport（全年合計、12 個月、跨年不計入）', async () => {
    await insertWithIds(harness.prisma, 'transactions', [
      {
        id: 20,
        ledger: 'personal',
        entry_type: 'expense',
        item: '機票',
        amount: 8000,
        category_id: 1,
        occurred_on: '2026-03-31',
        note: null,
        source: 'liff_form',
      },
      {
        id: 21,
        ledger: 'personal',
        entry_type: 'expense',
        item: '去年',
        amount: 999,
        category_id: 1,
        occurred_on: '2025-12-31',
        note: null,
        source: 'liff_form',
      },
      {
        id: 22,
        ledger: 'personal',
        entry_type: 'expense',
        item: '明年',
        amount: 777,
        category_id: 1,
        occurred_on: '2027-01-01',
        note: null,
        source: 'liff_form',
      },
    ]);
    const response = await request(app)
      .get('/api/reports/annual')
      .query({ year: '2026', ledger: 'personal' })
      .set(AUTH);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ledger: 'personal',
      year: 2026,
      incomeTotal: 50000,
      expenseTotal: 8220,
      balance: 41780,
    });
    expect(response.body.expenseByCategory[0]).toMatchObject({
      categoryId: 1,
      categoryName: '餐飲',
      amount: 8120,
      ratio: 98.8,
    });
    const monthly = response.body.expenseByCategory[0].monthlyAmounts as number[];
    expect(monthly).toHaveLength(12);
    expect(monthly[2]).toBe(8000);
    expect(monthly.reduce((sum, amount) => sum + amount, 0)).toBe(8120);
    expect(response.body.months).toHaveLength(12);
    expect(response.body.months[0]).toEqual({
      month: '2026-01',
      incomeTotal: 0,
      expenseTotal: 0,
      balance: 0,
    });
    expect(response.body.months[2]).toEqual({
      month: '2026-03',
      incomeTotal: 0,
      expenseTotal: 8000,
      balance: -8000,
    });
    expect(response.body.months[10]).toEqual({
      month: '2026-11',
      incomeTotal: 50000,
      expenseTotal: 220,
      balance: 49780,
    });
  });

  it('GET /api/reports/annual 省略參數 → 今年（Asia/Taipei）個人帳本', async () => {
    const response = await request(app).get('/api/reports/annual').set(AUTH);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ledger: 'personal', year: 2026 });
  });

  it('GET 年度統計參數不合法 → 400 INVALID_ARGUMENT', async () => {
    for (const year of ['26', '2026-11', '1999']) {
      expectErrorShape(
        await request(app).get('/api/reports/annual').query({ year }).set(AUTH),
        400,
        'INVALID_ARGUMENT',
      );
    }
  });

  it('GET 月度統計參數不合法 → 400 INVALID_ARGUMENT', async () => {
    expectErrorShape(
      await request(app).get('/api/reports/monthly').query({ month: '202611' }).set(AUTH),
      400,
      'INVALID_ARGUMENT',
    );
    expectErrorShape(
      await request(app).get('/api/reports/monthly').query({ ledger: '家庭' }).set(AUTH),
      400,
      'INVALID_ARGUMENT',
    );
  });
});

describe('[Security] 未通過 liff-auth 時一律不動資料', () => {
  const routes: Array<[string, string, (r: request.Test) => request.Test]> = [
    ['POST /api/transactions', 'post:/api/transactions', (r) => r.send(validBody)],
    ['PUT /api/transactions/10', 'put:/api/transactions/10', (r) => r.send(validBody)],
    ['DELETE /api/transactions/10', 'delete:/api/transactions/10', (r) => r],
    ['GET /api/transactions', 'get:/api/transactions?month=2026-11&ledger=personal', (r) => r],
    ['GET /api/reports/monthly', 'get:/api/reports/monthly', (r) => r],
    ['GET /api/reports/annual', 'get:/api/reports/annual', (r) => r],
  ];

  it.each(routes)('%s 無 Authorization → 401 UNAUTHENTICATED', async (_name, spec, shape) => {
    const [method, url] = spec.split(/:(.+)/) as [string, string];
    const agent = request(app) as unknown as Record<string, (u: string) => request.Test>;
    const response = await shape((agent[method] as (u: string) => request.Test)(url));

    expectErrorShape(response, 401, 'UNAUTHENTICATED');
    expect(await countTransactions()).toBe(3);
  });

  it.each(routes)('%s 非白名單身分 → 403 FORBIDDEN', async (_name, spec, shape) => {
    const [method, url] = spec.split(/:(.+)/) as [string, string];
    const agent = request(app) as unknown as Record<string, (u: string) => request.Test>;
    const response = await shape(
      (agent[method] as (u: string) => request.Test)(url).set('Authorization', 'Bearer U-stranger'),
    );

    expectErrorShape(response, 403, 'FORBIDDEN');
    expect(await countTransactions()).toBe(3);
  });
});
