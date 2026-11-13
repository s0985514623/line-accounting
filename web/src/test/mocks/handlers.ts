/**
 * MSW v2 handlers —— 回應形狀以 specs/api/api.yml 為唯一依據。
 * 內含一份記憶體 DB（resetMockDb 於每個測試前重置）與請求紀錄（供「只發一次請求」等斷言）。
 */
import { delay, http, HttpResponse } from 'msw';
import { VALID_ID_TOKEN } from './liff';

export { delay, http, HttpResponse, VALID_ID_TOKEN };

export type Ledger = 'personal' | 'company';
export type EntryType = 'expense' | 'income';
export type ViolationType =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'CATEGORY_MISMATCH'
  | 'DUPLICATE_NAME'
  | 'FALLBACK_CATEGORY_UNDELETABLE';

export interface CategoryRow {
  id: number;
  ledger: Ledger;
  entryType: EntryType;
  name: string;
  isFallback: boolean;
}

export interface TransactionRow {
  id: number;
  ledger: Ledger;
  entryType: EntryType;
  item: string;
  amount: number;
  categoryId: number;
  categoryName: string;
  occurredOn: string;
  note: string | null;
  source: 'line_text' | 'liff_form';
}

export const LIFF_ID = '1234567890-testliff';

function tx(
  id: number,
  ledger: Ledger,
  entryType: EntryType,
  item: string,
  amount: number,
  categoryId: number,
  categoryName: string,
  occurredOn: string,
  note: string | null,
  source: TransactionRow['source'],
): TransactionRow {
  return {
    id,
    ledger,
    entryType,
    item,
    amount,
    categoryId,
    categoryName,
    occurredOn,
    note,
    source,
  };
}

/** 分類種子：id 1/3/5 與 feature 一致；每個 帳本×收支 皆有一般分類與「其他」。 */
export const seedCategories: readonly CategoryRow[] = [
  { id: 1, ledger: 'personal', entryType: 'expense', name: '餐飲', isFallback: false },
  { id: 2, ledger: 'personal', entryType: 'expense', name: '交通', isFallback: false },
  { id: 7, ledger: 'personal', entryType: 'expense', name: '其他', isFallback: true },
  { id: 3, ledger: 'personal', entryType: 'income', name: '薪資', isFallback: false },
  { id: 4, ledger: 'personal', entryType: 'income', name: '獎金', isFallback: false },
  { id: 8, ledger: 'personal', entryType: 'income', name: '其他', isFallback: true },
  { id: 5, ledger: 'company', entryType: 'expense', name: '文具', isFallback: false },
  { id: 6, ledger: 'company', entryType: 'expense', name: '差旅', isFallback: false },
  { id: 9, ledger: 'company', entryType: 'expense', name: '其他', isFallback: true },
  { id: 11, ledger: 'company', entryType: 'income', name: '營業收入', isFallback: false },
  { id: 12, ledger: 'company', entryType: 'income', name: '其他', isFallback: true },
];

/** 記帳紀錄種子：與 查詢記帳紀錄列表.feature Background 一致。 */
export const seedTransactions: readonly TransactionRow[] = [
  tx(10, 'personal', 'expense', '午餐', 120, 1, '餐飲', '2026-11-12', null, 'line_text'),
  tx(11, 'personal', 'expense', '晚餐', 200, 1, '餐飲', '2026-11-12', '和朋友', 'line_text'),
  tx(12, 'personal', 'income', '薪資', 50000, 3, '薪資', '2026-11-05', null, 'liff_form'),
  tx(13, 'personal', 'expense', '宵夜', 90, 1, '餐飲', '2026-10-31', null, 'line_text'),
  tx(14, 'company', 'expense', '影印紙', 300, 5, '文具', '2026-11-03', null, 'line_text'),
];

// ───────────── 記憶體 DB ─────────────
let categories: CategoryRow[] = [];
let transactions: TransactionRow[] = [];
let nextId = 100;

export function resetMockDb(): void {
  categories = seedCategories.map((c) => ({ ...c }));
  transactions = seedTransactions.map((t) => ({ ...t }));
  nextId = 100;
  requestLog.length = 0;
}

export function getMockTransactions(): readonly TransactionRow[] {
  return transactions;
}

/** 測試需要自訂資料（例如 XSS 字串）時直接塞入記憶體 DB。 */
export function addMockTransaction(row: TransactionRow): void {
  transactions.push(row);
}

// ───────────── 請求紀錄 ─────────────
export interface LoggedRequest {
  method: string;
  pathname: string;
  query: Record<string, string>;
  authorization: string | null;
  body: unknown;
}

export const requestLog: LoggedRequest[] = [];

/** 由 server.events 'request:start' 記錄「所有」請求（含測試以 server.use 覆寫的 handler）；見 mocks/server.ts。 */
export function logRequest(request: Request): void {
  const url = new URL(request.url);
  const entry: LoggedRequest = {
    method: request.method,
    pathname: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    authorization: request.headers.get('authorization'),
    body: undefined,
  };
  requestLog.push(entry);
  if (request.method === 'POST' || request.method === 'PUT') {
    request
      .clone()
      .json()
      .then((body: unknown) => {
        entry.body = body;
      })
      .catch(() => undefined);
  }
}

/** 取出符合 method + pathname 的請求紀錄（pathname 可為字串或 RegExp）。 */
export function requestsTo(method: string, pathname: string | RegExp): LoggedRequest[] {
  return requestLog.filter(
    (r) =>
      r.method === method &&
      (typeof pathname === 'string' ? r.pathname === pathname : pathname.test(r.pathname)),
  );
}

// ───────────── 共用工具 ─────────────
export function errorResponse(status: number, violationType: ViolationType, message?: string) {
  return HttpResponse.json(
    { message: message ?? `server says ${violationType}`, violationType },
    { status },
  );
}

function checkAuth(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${VALID_ID_TOKEN}`) {
    return errorResponse(401, 'UNAUTHENTICATED', 'invalid id token');
  }
  return null;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function isLedger(v: unknown): v is Ledger {
  return v === 'personal' || v === 'company';
}
function isEntryType(v: unknown): v is EntryType {
  return v === 'expense' || v === 'income';
}

interface ValidInput {
  ledger: Ledger;
  entryType: EntryType;
  item: string;
  amount: number;
  categoryId: number;
  occurredOn: string;
  note: string | null;
}

/** 依 api.yml TransactionInput 驗證；回傳錯誤 Response 或乾淨的輸入。 */
function parseInput(body: unknown): { error: Response } | { value: ValidInput } {
  const b = (body ?? {}) as Record<string, unknown>;
  const invalid = () => ({ error: errorResponse(400, 'INVALID_ARGUMENT') });
  if (!isLedger(b.ledger) || !isEntryType(b.entryType)) return invalid();
  if (typeof b.item !== 'string' || b.item.length < 1 || b.item.length > 50) return invalid();
  if (typeof b.amount !== 'number' || !Number.isInteger(b.amount) || b.amount < 1) return invalid();
  if (typeof b.categoryId !== 'number' || !Number.isInteger(b.categoryId)) return invalid();
  if (!isRealDate(b.occurredOn)) return invalid();
  if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') return invalid();

  const category = categories.find((c) => c.id === b.categoryId);
  if (!category) return { error: errorResponse(404, 'NOT_FOUND') };
  if (category.ledger !== b.ledger || category.entryType !== b.entryType) {
    return { error: errorResponse(400, 'CATEGORY_MISMATCH') };
  }
  return {
    value: {
      ledger: b.ledger,
      entryType: b.entryType,
      item: b.item,
      amount: b.amount,
      categoryId: b.categoryId,
      occurredOn: b.occurredOn,
      note: typeof b.note === 'string' && b.note !== '' ? b.note : null,
    },
  };
}

function sortCategories(list: CategoryRow[]): CategoryRow[] {
  return [...list].sort((a, b) => Number(a.isFallback) - Number(b.isFallback) || a.id - b.id);
}

// ───────────── handlers ─────────────
export const handlers = [
  http.get('*/liff/config.json', () => HttpResponse.json({ liffId: LIFF_ID })),

  http.get('*/api/transactions', async ({ request }) => {
    const denied = checkAuth(request);
    if (denied) return denied;
    const url = new URL(request.url);
    const month = url.searchParams.get('month');
    const ledger = url.searchParams.get('ledger');
    if (!month || !MONTH_RE.test(month) || !isLedger(ledger)) {
      return errorResponse(400, 'INVALID_ARGUMENT');
    }
    const items = transactions
      .filter((t) => t.ledger === ledger && t.occurredOn.startsWith(`${month}-`))
      .sort((a, b) =>
        a.occurredOn === b.occurredOn ? b.id - a.id : a.occurredOn < b.occurredOn ? 1 : -1,
      );
    return HttpResponse.json({ items });
  }),

  http.post('*/api/transactions', async ({ request }) => {
    const denied = checkAuth(request);
    if (denied) return denied;
    const parsed = parseInput(
      await request
        .clone()
        .json()
        .catch(() => undefined),
    );
    if ('error' in parsed) return parsed.error;
    const category = categories.find((c) => c.id === parsed.value.categoryId)!;
    const created: TransactionRow = {
      id: nextId++,
      ...parsed.value,
      categoryName: category.name,
      source: 'liff_form',
    };
    transactions.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.post('*/api/transactions/batch', async ({ request }) => {
    const denied = checkAuth(request);
    if (denied) return denied;
    const body: unknown = await request
      .clone()
      .json()
      .catch(() => undefined);
    const rawItems = (body as { items?: unknown } | undefined)?.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 50) {
      return errorResponse(400, 'INVALID_ARGUMENT');
    }
    const parsedItems = rawItems.map((raw) => parseInput(raw));
    for (const parsed of parsedItems) {
      if ('error' in parsed) return parsed.error;
    }
    const items = parsedItems.map((parsed) => {
      if ('error' in parsed) throw new Error('unreachable');
      const category = categories.find((c) => c.id === parsed.value.categoryId)!;
      const created: TransactionRow = {
        id: nextId++,
        ...parsed.value,
        categoryName: category.name,
        source: 'liff_form',
      };
      transactions.push(created);
      return created;
    });
    return HttpResponse.json({ items }, { status: 201 });
  }),

  http.put('*/api/transactions/:id', async ({ request, params }) => {
    const denied = checkAuth(request);
    if (denied) return denied;
    const id = Number(params.id);
    const existing = transactions.find((t) => t.id === id);
    if (!existing) return errorResponse(404, 'NOT_FOUND');
    const parsed = parseInput(
      await request
        .clone()
        .json()
        .catch(() => undefined),
    );
    if ('error' in parsed) return parsed.error;
    const category = categories.find((c) => c.id === parsed.value.categoryId)!;
    Object.assign(existing, parsed.value, { categoryName: category.name });
    return HttpResponse.json(existing);
  }),

  http.delete('*/api/transactions/:id', async ({ request, params }) => {
    const denied = checkAuth(request);
    if (denied) return denied;
    const id = Number(params.id);
    const index = transactions.findIndex((t) => t.id === id);
    if (index < 0) return errorResponse(404, 'NOT_FOUND');
    transactions.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('*/api/categories', async ({ request }) => {
    const denied = checkAuth(request);
    if (denied) return denied;
    const url = new URL(request.url);
    const ledger = url.searchParams.get('ledger');
    const entryType = url.searchParams.get('entryType');
    if (!isLedger(ledger) || !isEntryType(entryType)) {
      return errorResponse(400, 'INVALID_ARGUMENT');
    }
    const items = sortCategories(
      categories.filter((c) => c.ledger === ledger && c.entryType === entryType),
    );
    return HttpResponse.json({ items });
  }),

  // 新增分類（api.yml：201 / 400 INVALID_ARGUMENT / 409 DUPLICATE_NAME；名稱 trim 後 1–50 字）
  http.post('*/api/categories', async ({ request }) => {
    const denied = checkAuth(request);
    if (denied) return denied;
    const b = (await request
      .clone()
      .json()
      .catch(() => undefined)) as Record<string, unknown> | undefined;
    if (!b || !isLedger(b.ledger) || !isEntryType(b.entryType) || typeof b.name !== 'string') {
      return errorResponse(400, 'INVALID_ARGUMENT');
    }
    const name = b.name.trim();
    if (name.length < 1 || name.length > 50) return errorResponse(400, 'INVALID_ARGUMENT');
    const duplicated = categories.some(
      (c) => c.ledger === b.ledger && c.entryType === b.entryType && c.name === name,
    );
    if (duplicated) return errorResponse(409, 'DUPLICATE_NAME');
    const created: CategoryRow = {
      id: nextId++,
      ledger: b.ledger,
      entryType: b.entryType,
      name,
      isFallback: false,
    };
    categories.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  // 刪除分類（api.yml：204 / 404 / 422 FALLBACK_CATEGORY_UNDELETABLE）；
  // 該分類的記帳紀錄改歸同帳本同收支的「其他」
  http.delete('*/api/categories/:id', async ({ request, params }) => {
    const denied = checkAuth(request);
    if (denied) return denied;
    const target = categories.find((c) => c.id === Number(params.id));
    if (!target) return errorResponse(404, 'NOT_FOUND');
    if (target.isFallback) return errorResponse(422, 'FALLBACK_CATEGORY_UNDELETABLE');
    const fallback = categories.find(
      (c) => c.isFallback && c.ledger === target.ledger && c.entryType === target.entryType,
    )!;
    for (const t of transactions) {
      if (t.categoryId === target.id) {
        t.categoryId = fallback.id;
        t.categoryName = fallback.name;
      }
    }
    categories = categories.filter((c) => c.id !== target.id);
    return new HttpResponse(null, { status: 204 });
  }),

  // 月度統計（api.yml：month / ledger 皆可省略；省略時為本月（Asia/Taipei）與 personal）
  http.get('*/api/reports/monthly', async ({ request }) => {
    const denied = checkAuth(request);
    if (denied) return denied;
    const url = new URL(request.url);
    const monthParam = url.searchParams.get('month');
    const ledgerParam = url.searchParams.get('ledger');
    if (monthParam !== null && !MONTH_RE.test(monthParam)) {
      return errorResponse(400, 'INVALID_ARGUMENT');
    }
    if (ledgerParam !== null && !isLedger(ledgerParam)) {
      return errorResponse(400, 'INVALID_ARGUMENT');
    }
    const month = monthParam ?? new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 7);
    const ledger: Ledger = ledgerParam ?? 'personal';
    const inMonth = transactions.filter(
      (t) => t.ledger === ledger && t.occurredOn.startsWith(`${month}-`),
    );
    const sum = (type: EntryType) =>
      inMonth.filter((t) => t.entryType === type).reduce((acc, t) => acc + t.amount, 0);
    const incomeTotal = sum('income');
    const expenseTotal = sum('expense');
    const byCategory = new Map<string, number>();
    for (const t of inMonth.filter((x) => x.entryType === 'expense')) {
      byCategory.set(t.categoryName, (byCategory.get(t.categoryName) ?? 0) + t.amount);
    }
    const expenseByCategory = [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([categoryName, amount]) => ({
        categoryName,
        amount,
        ratio: Math.round((amount / expenseTotal) * 1000) / 10,
      }));
    return HttpResponse.json({
      ledger,
      month,
      incomeTotal,
      expenseTotal,
      balance: incomeTotal - expenseTotal,
      expenseByCategory,
    });
  }),
];
