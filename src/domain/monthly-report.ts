/**
 * 月度報表彙總（純計算，無 I/O）。
 * LINE 月度文字摘要（P5）與 LIFF 統計 API（P7 GET /api/reports/monthly）共用同一份 MonthlyReport。
 *
 *  - balance = incomeTotal - expenseTotal（可為負）。
 *  - expenseByCategory / incomeByCategory 分別只含支出 / 收入；
 *    ratio = Math.round(amount * 1000 / 該收支合計) / 10（0–100，小數一位），不做「總和補足 100」的調整。
 *  - 排序：金額降冪、同額 categoryId 升冪（ASM-09）。該收支無紀錄 → []。
 * 依據：specs/features/report/查詢月度文字摘要.feature、查詢月度統計圖表.feature；implementation-plan P5-2。
 */
import type { EntryType, Ledger } from './enums';

/** 已按 (entryType, categoryId) 彙總的一列；amount 為該組金額總和。 */
export interface CategoryTotalRow {
  entryType: EntryType;
  categoryId: number;
  categoryName: string;
  amount: number;
}

/** 分類的金額與佔比（%；分母為同收支合計）。 */
export interface CategoryShare {
  categoryId: number;
  categoryName: string;
  amount: number;
  ratio: number;
}

/** @deprecated 改用 CategoryShare */
export type ExpenseCategoryShare = CategoryShare;

export interface MonthlyReport {
  ledger: Ledger;
  /** 'YYYY-MM' */
  month: string;
  incomeTotal: number;
  expenseTotal: number;
  balance: number;
  expenseByCategory: CategoryShare[];
  incomeByCategory: CategoryShare[];
}

export interface MonthlyReportInput {
  ledger: Ledger;
  /** 'YYYY-MM'，原樣帶入結果 */
  month: string;
  rows: readonly CategoryTotalRow[];
}

/** 佔比（%），四捨五入至小數一位。呼叫端保證 total > 0。 */
function toRatio(amount: number, total: number): number {
  return Math.round((amount * 1000) / total) / 10;
}

/** 金額降冪、同額 categoryId 升冪（ASM-09）。 */
function compareShares(a: CategoryShare, b: CategoryShare): number {
  return b.amount - a.amount || a.categoryId - b.categoryId;
}

function sumAmounts(rows: readonly CategoryTotalRow[]): number {
  return rows.reduce((total, row) => total + row.amount, 0);
}

/** 同收支的列 → 佔比清單（已排序）；total 為 0 → []。 */
function toShares(rows: readonly CategoryTotalRow[], total: number): CategoryShare[] {
  if (total <= 0) return [];
  return rows
    .map((row) => ({
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      amount: row.amount,
      ratio: toRatio(row.amount, total),
    }))
    .sort(compareShares);
}

/** 由彙總列計算月度報表（純函式，不修改輸入）。 */
export function buildMonthlyReport(input: MonthlyReportInput): MonthlyReport {
  const incomeRows = input.rows.filter((row) => row.entryType === 'income');
  const expenseRows = input.rows.filter((row) => row.entryType === 'expense');
  const incomeTotal = sumAmounts(incomeRows);
  const expenseTotal = sumAmounts(expenseRows);

  const expenseByCategory = toShares(expenseRows, expenseTotal);
  const incomeByCategory = toShares(incomeRows, incomeTotal);

  return {
    ledger: input.ledger,
    month: input.month,
    incomeTotal,
    expenseTotal,
    balance: incomeTotal - expenseTotal,
    expenseByCategory,
    incomeByCategory,
  };
}
