/**
 * 單元測試：記帳 API 輸入驗證 schema（src/http/schemas/transaction.ts）
 *
 * 執行：npx vitest run tests/unit/http/transaction-schema.test.ts
 *
 * 契約（nodejs-master 請遵循；依據 implementation-plan P7-1、ASM-03、specs/api/api.yml、
 *       specs/features/transaction/{以表單記帳,編輯記帳紀錄,查詢記帳紀錄列表}.feature）：
 *   src/http/schemas/transaction.ts 匯出三個 zod（v4）schema，皆可直接 `.safeParse(input)`：
 *     TransactionInputSchema        POST /api/transactions 與 PUT /api/transactions/{id} 的 JSON body
 *       - ledger / entryType：enum（personal|company、expense|income）
 *       - item：字串，trim 後 1–50 字，輸出為 trim 後的值
 *       - amount：number 且為整數，1 ≤ amount ≤ 99_999_999（字串 '120' 不接受，不做 coerce）
 *       - categoryId：number 且為整數
 *       - occurredOn：嚴格 YYYY-MM-DD 且日曆上存在（2026-02-30、2026-13-01 失敗）
 *       - note：可省略 / null / 字串；空字串 → null（輸出 null；省略視為 null 或 undefined 皆可）
 *     ListTransactionsQuerySchema   GET /api/transactions 的 query：month（嚴格 YYYY-MM）、ledger（enum）皆必填
 *     TransactionIdParamSchema      path 參數 { id: string } → { id: number }（僅十進位非負整數字串）
 *   驗證失敗一律 success=false（路由層經 parseInput 轉成 INVALID_ARGUMENT / 400）。
 */
import { describe, expect, it } from 'vitest';
import {
  ListTransactionsQuerySchema,
  TransactionIdParamSchema,
  TransactionInputSchema,
} from '../../../src/http/schemas/transaction';

/** 合法的基準輸入；各案例只覆寫要測的欄位。 */
function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ledger: 'personal',
    entryType: 'expense',
    item: '午餐',
    amount: 120,
    categoryId: 1,
    occurredOn: '2026-11-10',
    note: '和朋友',
    ...overrides,
  };
}

function parse(input: unknown) {
  return TransactionInputSchema.safeParse(input);
}

/** 移除某欄位（模擬缺欄位）。 */
function without(field: string): Record<string, unknown> {
  const input = valid();
  delete input[field];
  return input;
}

describe('[Smoke] TransactionInputSchema：合法輸入', () => {
  it('完整合法輸入通過，輸出內容不變', () => {
    const result = parse(valid());
    expect(result.success).toBe(true);
    expect(result.data).toEqual(valid());
  });
});

describe('[Happy] note 處理', () => {
  it('空字串 → null', () => {
    const result = parse(valid({ note: '' }));
    expect(result.success).toBe(true);
    expect(result.data?.note).toBeNull();
  });

  it('null → null', () => {
    const result = parse(valid({ note: null }));
    expect(result.success).toBe(true);
    expect(result.data?.note).toBeNull();
  });

  it('省略 note → 通過，且視為無備註（null 或 undefined）', () => {
    const result = parse(without('note'));
    expect(result.success).toBe(true);
    expect(result.data?.note ?? null).toBeNull();
  });

  it('有內容的備註原樣保留（含 Emoji、換行）', () => {
    const note = '和朋友 😀\n第二行';
    const result = parse(valid({ note }));
    expect(result.success).toBe(true);
    expect(result.data?.note).toBe(note);
  });
});

describe('[Edge] amount 邊界（ASM-03：1 ≤ amount ≤ 99,999,999 的整數）', () => {
  it.each([
    [1, '最小額'],
    [120, '一般'],
    [99_999_999, '上限'],
  ])('%s（%s）通過', (amount, _name) => {
    expect(parse(valid({ amount })).success).toBe(true);
  });

  it.each([
    [0, '零'],
    [-1, '負數'],
    [12.5, '小數'],
    [0.1, '小於 1 的小數'],
    [100_000_000, '超過上限 1'],
    [Number.MAX_SAFE_INTEGER, '極大值'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    ['120', '字串（不做轉型）'],
    [null, 'null'],
    [true, '布林'],
  ])('%s（%s）失敗', (amount, _name) => {
    expect(parse(valid({ amount })).success).toBe(false);
  });

  it('缺少 amount 失敗', () => {
    expect(parse(without('amount')).success).toBe(false);
  });
});

describe('[Edge] occurredOn 日期（嚴格 YYYY-MM-DD 且真實存在）', () => {
  it.each(['2026-11-10', '2026-10-31', '2024-02-29', '2026-12-31', '2026-01-01'])(
    '%s 通過',
    (occurredOn) => {
      expect(parse(valid({ occurredOn })).success).toBe(true);
    },
  );

  it.each([
    ['2026-02-30', '2 月沒有 30 日'],
    ['2026-02-29', '非閏年 2 月 29 日'],
    ['2026-13-01', '13 月'],
    ['2026-00-10', '0 月'],
    ['2026-11-00', '0 日'],
    ['2026-11-31', '11 月沒有 31 日'],
    ['2026-1-1', '未補零'],
    ['20261110', '無分隔'],
    ['2026/11/10', '斜線分隔'],
    ['2026-11-10T00:00:00Z', 'ISO 日期時間'],
    [' 2026-11-10', '前置空白'],
    ['2026-11-10 ', '後置空白'],
    ['', '空字串'],
    ['今天', '非日期'],
    [20261110, '數字'],
    [null, 'null'],
  ])('%s（%s）失敗', (occurredOn, _name) => {
    expect(parse(valid({ occurredOn })).success).toBe(false);
  });

  it('缺少 occurredOn 失敗', () => {
    expect(parse(without('occurredOn')).success).toBe(false);
  });
});

describe('[Edge] item 項目（trim 後 1–50 字）', () => {
  it('前後空白會被 trim', () => {
    const result = parse(valid({ item: '  午餐  ' }));
    expect(result.success).toBe(true);
    expect(result.data?.item).toBe('午餐');
  });

  it('剛好 50 字通過', () => {
    expect(parse(valid({ item: '字'.repeat(50) })).success).toBe(true);
  });

  it('51 字失敗', () => {
    expect(parse(valid({ item: '字'.repeat(51) })).success).toBe(false);
  });

  it('前後空白不計入長度：50 字 + 前後空白通過', () => {
    expect(parse(valid({ item: ` ${'字'.repeat(50)} ` })).success).toBe(true);
  });

  it.each([
    ['空字串', ''],
    ['全空白', '   '],
    ['null', null],
    ['數字', 123],
  ])('%s 失敗', (_name, item) => {
    expect(parse(valid({ item })).success).toBe(false);
  });

  it('缺少 item 失敗', () => {
    expect(parse(without('item')).success).toBe(false);
  });

  it.each([
    ['SQL 注入字串', "'; DROP TABLE transactions; --"],
    ['HTML/XSS 字串', '<script>alert(1)</script>'],
    ['RTL 字元', 'שלום עולם'],
  ])('%s 視為一般文字通過（輸出時由前端跳脫，後端不過濾）', (_name, item) => {
    const result = parse(valid({ item }));
    expect(result.success).toBe(true);
    expect(result.data?.item).toBe(item);
  });
});

describe('[Error] ledger / entryType / categoryId', () => {
  it.each(['個人', 'PERSONAL', '', 'family', null, 1])('ledger=%j 失敗', (ledger) => {
    expect(parse(valid({ ledger })).success).toBe(false);
  });

  it.each(['支出', 'EXPENSE', '', 'transfer', null, 1])('entryType=%j 失敗', (entryType) => {
    expect(parse(valid({ entryType })).success).toBe(false);
  });

  it.each([
    ['小數', 1.5],
    ['字串', '1'],
    ['null', null],
    ['NaN', Number.NaN],
  ])('categoryId 為%s 失敗', (_name, categoryId) => {
    expect(parse(valid({ categoryId })).success).toBe(false);
  });

  it.each(['ledger', 'entryType', 'categoryId'])('缺少 %s 失敗', (field) => {
    expect(parse(without(field)).success).toBe(false);
  });

  it.each([
    ['null', null],
    ['字串', 'abc'],
    ['陣列', []],
    ['undefined', undefined],
  ])('整個 body 為%s 失敗', (_name, input) => {
    expect(parse(input).success).toBe(false);
  });
});

describe('[Happy] ListTransactionsQuerySchema', () => {
  it('合法 month + ledger 通過', () => {
    const result = ListTransactionsQuerySchema.safeParse({ month: '2026-11', ledger: 'personal' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ month: '2026-11', ledger: 'personal' });
  });

  it.each([
    [{ ledger: 'personal' }, '缺少 month'],
    [{ month: '2026-11' }, '缺少 ledger'],
    [{ month: '', ledger: 'personal' }, 'month 空字串'],
    [{ month: '2026-13', ledger: 'personal' }, 'month 13 月'],
    [{ month: '2026-00', ledger: 'personal' }, 'month 0 月'],
    [{ month: '202611', ledger: 'personal' }, 'month 無分隔'],
    [{ month: '2026-1', ledger: 'personal' }, 'month 未補零'],
    [{ month: '2026-11-01', ledger: 'personal' }, 'month 含日'],
    [{ month: '2026-11', ledger: '個人' }, 'ledger 中文'],
    [{ month: '2026-11', ledger: '' }, 'ledger 空字串'],
  ])('%j（%s）失敗', (input, _name) => {
    expect(ListTransactionsQuerySchema.safeParse(input).success).toBe(false);
  });
});

describe('[Edge] TransactionIdParamSchema', () => {
  it('十進位字串轉成 number', () => {
    const result = TransactionIdParamSchema.safeParse({ id: '10' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 10 });
  });

  it.each(['abc', '', '1.5', '-1', '1e3', ' 10', '0x10', '10abc'])('id=%j 失敗', (id) => {
    expect(TransactionIdParamSchema.safeParse({ id }).success).toBe(false);
  });
});
