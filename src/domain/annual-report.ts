/**
 * 年度報表彙總（純計算，無 I/O）。
 *
 *  - 合計、結餘、分類佔比：規則與月度報表相同（重用 buildMonthlyReport：金額降冪、同額 categoryId 升冪，
 *    ratio 四捨五入至小數一位）。
 *  - months：固定 12 筆（1–12 月，依序），沒有紀錄的月份金額為 0；balance = income - expense。
 */
import type { EntryType, Ledger } from './enums';
import { buildMonthlyReport, type CategoryShare, type CategoryTotalRow } from './monthly-report';

/** 已按 (月份, 收支) 彙總的一列。 */
export interface MonthTotalRow {
  /** 'YYYY-MM' */
  month: string;
  entryType: EntryType;
  amount: number;
}

export interface MonthTotals {
  /** 'YYYY-MM' */
  month: string;
  incomeTotal: number;
  expenseTotal: number;
  balance: number;
}

export interface AnnualReport {
  ledger: Ledger;
  year: number;
  incomeTotal: number;
  expenseTotal: number;
  balance: number;
  expenseByCategory: CategoryShare[];
  incomeByCategory: CategoryShare[];
  /** 1–12 月，固定 12 筆 */
  months: MonthTotals[];
}

export interface AnnualReportInput {
  ledger: Ledger;
  year: number;
  categoryRows: readonly CategoryTotalRow[];
  monthRows: readonly MonthTotalRow[];
}

function monthKey(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function buildAnnualReport(input: AnnualReportInput): AnnualReport {
  const base = buildMonthlyReport({
    ledger: input.ledger,
    month: String(input.year),
    rows: input.categoryRows,
  });

  const months = Array.from({ length: 12 }, (_, index) => {
    const month = monthKey(input.year, index + 1);
    const sum = (entryType: EntryType) =>
      input.monthRows
        .filter((row) => row.month === month && row.entryType === entryType)
        .reduce((total, row) => total + row.amount, 0);
    const incomeTotal = sum('income');
    const expenseTotal = sum('expense');
    return { month, incomeTotal, expenseTotal, balance: incomeTotal - expenseTotal };
  });

  return {
    ledger: input.ledger,
    year: input.year,
    incomeTotal: base.incomeTotal,
    expenseTotal: base.expenseTotal,
    balance: base.balance,
    expenseByCategory: base.expenseByCategory,
    incomeByCategory: base.incomeByCategory,
    months,
  };
}
