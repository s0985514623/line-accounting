/**
 * 單元測試：月度報表彙總（純計算，無 I/O；P5 LINE 文字摘要與 P7 LIFF 統計 API 共用）
 *
 * 執行：npx vitest run tests/unit/domain/monthly-report.test.ts
 *
 * 契約（nodejs-master 請遵循）：src/domain/monthly-report.ts
 *   export interface CategoryTotalRow { entryType: EntryType; categoryId: number; categoryName: string; amount: number }
 *     // 「已按 (entryType, categoryId) 彙總」的一列；amount 為該組金額總和（正整數）
 *   export interface ExpenseCategoryShare { categoryId: number; categoryName: string; amount: number; ratio: number }
 *   export interface MonthlyReport {
 *     ledger: Ledger; month: string;            // 'YYYY-MM'，原樣帶入
 *     incomeTotal: number; expenseTotal: number; balance: number;   // balance = incomeTotal - expenseTotal
 *     expenseByCategory: ExpenseCategoryShare[];
 *   }
 *   export function buildMonthlyReport(input: { ledger: Ledger; month: string; rows: readonly CategoryTotalRow[] }): MonthlyReport
 *     // 純函式：不修改 input；ratio = Math.round(amount * 1000 / expenseTotal) / 10（四捨五入至小數一位，數值 0–100）；
 *     // expenseByCategory 只含 entryType='expense'，金額降冪、同額 categoryId 升冪（ASM-09）；無支出 → []；
 *     // 不對 ratio 做「總和補足 100」的調整。
 *
 * 與 DB 查詢分離（P7 重用）：src/services/report-service.ts 只負責
 *     getMonthlyReport(ledger: Ledger, month: string): Promise<MonthlyReport>
 *   = monthRange(month) → prisma.transaction.groupBy({ by: ['entryType','categoryId'], _sum: { amount } }) + 分類名稱 join
 *     → 組成 CategoryTotalRow[] → buildMonthlyReport(...)。
 *   LINE 摘要（summary-replies）與 P7 `GET /api/reports/monthly`（mapper 取 categoryName/amount/ratio）都只消費 MonthlyReport。
 * 依據：specs/features/report/查詢月度文字摘要.feature、查詢月度統計圖表.feature；api.yml MonthlyReport；ASM-09。
 */
import { describe, expect, it } from 'vitest';
import { buildMonthlyReport, type CategoryTotalRow } from '../../../src/domain/monthly-report';

const expense = (categoryId: number, categoryName: string, amount: number): CategoryTotalRow => ({
  entryType: 'expense',
  categoryId,
  categoryName,
  amount,
});
const income = (categoryId: number, categoryName: string, amount: number): CategoryTotalRow => ({
  entryType: 'income',
  categoryId,
  categoryName,
  amount,
});

const build = (rows: CategoryTotalRow[], ledger: 'personal' | 'company' = 'personal') =>
  buildMonthlyReport({ ledger, month: '2026-11', rows });

describe('[Smoke] buildMonthlyReport：規格範例（個人 2026-11）', () => {
  it('收入 50000、支出 餐飲 300 + 其他 100 → 結餘 49600，佔比 75.0 / 25.0', () => {
    expect(
      build([income(3, '薪資', 50000), expense(1, '餐飲', 300), expense(2, '其他', 100)]),
    ).toEqual({
      ledger: 'personal',
      month: '2026-11',
      incomeTotal: 50000,
      expenseTotal: 400,
      balance: 49600,
      expenseByCategory: [
        { categoryId: 1, categoryName: '餐飲', amount: 300, ratio: 75 },
        { categoryId: 2, categoryName: '其他', amount: 100, ratio: 25 },
      ],
      incomeByCategory: [{ categoryId: 3, categoryName: '薪資', amount: 50000, ratio: 100 }],
    });
  });
});

describe('[Happy] 佔比四捨五入至小數一位', () => {
  it('公司本月：其他 200 / 文具 100 → 66.7 / 33.3（金額大者在前，即使 id 較大）', () => {
    const report = build([expense(5, '文具', 100), expense(6, '其他', 200)], 'company');
    expect(report.expenseByCategory.map((c) => [c.categoryName, c.amount, c.ratio])).toEqual([
      ['其他', 200, 66.7],
      ['文具', 100, 33.3],
    ]);
    expect(report.ledger).toBe('company');
  });

  it('單一支出分類 → 100', () => {
    const report = build([expense(1, '餐飲', 90)]);
    expect(report.expenseByCategory).toEqual([
      { categoryId: 1, categoryName: '餐飲', amount: 90, ratio: 100 },
    ]);
  });

  it('多筆收入分類只加總進 incomeTotal，不出現在 expenseByCategory', () => {
    const report = build([
      income(3, '薪資', 50000),
      income(4, '獎金', 1234),
      expense(1, '餐飲', 100),
    ]);
    expect(report.incomeTotal).toBe(51234);
    expect(report.expenseByCategory.map((c) => c.categoryName)).toEqual(['餐飲']);
  });
});

describe('[Happy] incomeByCategory', () => {
  it('收入分類佔比以 incomeTotal 為分母，金額降冪、同額 id 升冪', () => {
    const report = build([
      income(4, '獎金', 10000),
      income(3, '薪資', 50000),
      income(5, '利息', 10000),
      expense(1, '餐飲', 100),
    ]);
    expect(report.incomeByCategory.map((c) => [c.categoryName, c.amount, c.ratio])).toEqual([
      ['薪資', 50000, 71.4],
      ['獎金', 10000, 14.3],
      ['利息', 10000, 14.3],
    ]);
  });

  it('沒有收入 → []', () => {
    expect(build([expense(1, '餐飲', 100)]).incomeByCategory).toEqual([]);
  });
});

describe('[Edge] 四捨五入邊界', () => {
  it('三等分 → 每項 33.3（總和 99.9，不做補足）', () => {
    const report = build([expense(1, 'A', 100), expense(2, 'B', 100), expense(3, 'C', 100)]);
    expect(report.expenseByCategory.map((c) => c.ratio)).toEqual([33.3, 33.3, 33.3]);
  });

  it('剛好 .x5 進位：1/16 = 6.25% → 6.3；15/16 → 93.8（四捨五入，非銀行家捨入）', () => {
    const report = build([expense(1, 'A', 15), expense(2, 'B', 1)]);
    expect(report.expenseByCategory.map((c) => c.ratio)).toEqual([93.8, 6.3]);
  });

  it('1/8 = 12.5 剛好一位小數、7/8 = 87.5', () => {
    const report = build([expense(1, 'A', 7), expense(2, 'B', 1)]);
    expect(report.expenseByCategory.map((c) => c.ratio)).toEqual([87.5, 12.5]);
  });

  it('極小佔比：1/2000 = 0.05% → 0.1；1/100000 → 0', () => {
    const half = build([expense(1, 'A', 1999), expense(2, 'B', 1)]);
    expect(half.expenseByCategory.at(-1)?.ratio).toBe(0.1);
    const tiny = build([expense(1, 'A', 99_999), expense(2, 'B', 1)]);
    expect(tiny.expenseByCategory.at(-1)?.ratio).toBe(0);
  });

  it('金額極大：加總超過 32 位元整數仍正確', () => {
    const rows = Array.from({ length: 50 }, (_, i) => expense(i + 1, `分類${i + 1}`, 99_999_999));
    const report = build(rows);
    expect(report.expenseTotal).toBe(4_999_999_950);
    expect(report.balance).toBe(-4_999_999_950);
    expect(report.expenseByCategory).toHaveLength(50);
    expect(report.expenseByCategory.every((c) => c.ratio === 2)).toBe(true);
  });
});

describe('[Edge] 排序：金額降冪、同額 categoryId 升冪（ASM-09）', () => {
  it('輸入為金額升冪 → 輸出降冪', () => {
    const report = build([expense(1, 'A', 10), expense(2, 'B', 20), expense(3, 'C', 30)]);
    expect(report.expenseByCategory.map((c) => c.categoryName)).toEqual(['C', 'B', 'A']);
  });

  it('同額時依 categoryId 升冪，不受輸入順序影響', () => {
    const forward = build([expense(7, 'G', 100), expense(3, 'C', 100), expense(5, 'E', 100)]);
    const reversed = build([expense(5, 'E', 100), expense(3, 'C', 100), expense(7, 'G', 100)]);
    expect(forward.expenseByCategory.map((c) => c.categoryId)).toEqual([3, 5, 7]);
    expect(reversed.expenseByCategory.map((c) => c.categoryId)).toEqual([3, 5, 7]);
  });

  it('金額優先於 id：大額高 id 排在小額低 id 之前；同額群組內再依 id', () => {
    const report = build([
      expense(1, 'A', 50),
      expense(9, 'I', 200),
      expense(4, 'D', 50),
      expense(2, 'B', 200),
    ]);
    expect(report.expenseByCategory.map((c) => c.categoryId)).toEqual([2, 9, 1, 4]);
  });
});

describe('[Edge] 無支出 / 無資料 / 負結餘', () => {
  it('無支出 → expenseTotal 0、expenseByCategory 為空陣列（不得除以 0 產生 NaN）', () => {
    const report = build([income(3, '薪資', 50000)]);
    expect(report.expenseTotal).toBe(0);
    expect(report.expenseByCategory).toEqual([]);
    expect(report.balance).toBe(50000);
  });

  it('完全沒有資料 → 全部為 0（且不是 -0）、分類為空', () => {
    const report = build([]);
    expect(report.incomeTotal).toBe(0);
    expect(report.expenseTotal).toBe(0);
    expect(report.balance).toBe(0);
    expect(report.expenseByCategory).toEqual([]);
  });

  it('支出大於收入 → 結餘為負數（-90）', () => {
    const report = build([expense(1, '餐飲', 90)]);
    expect(report.incomeTotal).toBe(0);
    expect(report.balance).toBe(-90);
  });
});

describe('[Edge] 純函式性質', () => {
  it('不修改輸入陣列與其元素（順序、內容不變）', () => {
    const rows = [expense(2, 'B', 10), expense(1, 'A', 30), income(3, 'C', 5)];
    const snapshot = structuredClone(rows);
    build(rows);
    expect(rows).toEqual(snapshot);
  });

  it('ledger 與 month 原樣帶入（供 summary 標題與 P7 回應使用）', () => {
    const report = buildMonthlyReport({ ledger: 'company', month: '2025-12', rows: [] });
    expect(report.ledger).toBe('company');
    expect(report.month).toBe('2025-12');
  });

  it('分類名稱原樣保留（Emoji、含空白、符號）', () => {
    const report = build([expense(1, '☕ 咖啡 & 茶', 10)]);
    expect(report.expenseByCategory[0]?.categoryName).toBe('☕ 咖啡 & 茶');
  });
});
