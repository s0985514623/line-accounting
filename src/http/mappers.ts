/**
 * Repository 資料 → API DTO（specs/api/api.yml components/schemas）。
 */
import type { EntrySource, EntryType, Ledger } from '../domain/enums';
import type { AnnualCategoryShare, AnnualReport } from '../domain/annual-report';
import type { CategoryShare, MonthlyReport } from '../domain/monthly-report';
import type { CategoryDetail } from '../repositories/category-repository';
import type {
  RecurringEntryDetail,
  RecurringOccurrenceDetail,
} from '../repositories/recurring-repository';
import type { TransactionDetail } from '../repositories/transaction-repository';

export interface CategoryDto {
  id: number;
  ledger: Ledger;
  entryType: EntryType;
  name: string;
  isFallback: boolean;
}

export function toCategoryDto(category: CategoryDetail): CategoryDto {
  return {
    id: category.id,
    ledger: category.ledger,
    entryType: category.entryType,
    name: category.name,
    isFallback: category.isFallback,
  };
}

export interface TransactionDto {
  id: number;
  ledger: Ledger;
  entryType: EntryType;
  item: string;
  amount: number;
  categoryId: number;
  categoryName: string;
  /** YYYY-MM-DD */
  occurredOn: string;
  note: string | null;
  source: EntrySource;
}

export function toTransactionDto(transaction: TransactionDetail): TransactionDto {
  return {
    id: transaction.id,
    ledger: transaction.ledger,
    entryType: transaction.entryType,
    item: transaction.item,
    amount: transaction.amount,
    categoryId: transaction.categoryId,
    categoryName: transaction.categoryName,
    occurredOn: transaction.occurredOn,
    note: transaction.note,
    source: transaction.source,
  };
}

export interface ExpenseCategoryShareDto {
  categoryId: number;
  categoryName: string;
  amount: number;
  /** 百分比，四捨五入至小數一位 */
  ratio: number;
}

export interface MonthlyReportDto {
  ledger: Ledger;
  /** YYYY-MM */
  month: string;
  incomeTotal: number;
  expenseTotal: number;
  balance: number;
  expenseByCategory: ExpenseCategoryShareDto[];
  incomeByCategory: ExpenseCategoryShareDto[];
}

function toShareDto(share: CategoryShare): ExpenseCategoryShareDto {
  return {
    categoryId: share.categoryId,
    categoryName: share.categoryName,
    amount: share.amount,
    ratio: share.ratio,
  };
}

export function toMonthlyReportDto(report: MonthlyReport): MonthlyReportDto {
  return {
    ledger: report.ledger,
    month: report.month,
    incomeTotal: report.incomeTotal,
    expenseTotal: report.expenseTotal,
    balance: report.balance,
    expenseByCategory: report.expenseByCategory.map(toShareDto),
    incomeByCategory: report.incomeByCategory.map(toShareDto),
  };
}

export interface RecurringEntryDto {
  id: number;
  ledger: Ledger;
  entryType: EntryType;
  item: string;
  amount: number;
  categoryId: number;
  categoryName: string;
  dayOfMonth: number;
  note: string | null;
  active: boolean;
  /** YYYY-MM-DD */
  nextDueOn: string;
}

export function toRecurringEntryDto(entry: RecurringEntryDetail): RecurringEntryDto {
  return {
    id: entry.id,
    ledger: entry.ledger,
    entryType: entry.entryType,
    item: entry.item,
    amount: entry.amount,
    categoryId: entry.categoryId,
    categoryName: entry.categoryName,
    dayOfMonth: entry.dayOfMonth,
    note: entry.note,
    active: entry.active,
    nextDueOn: entry.nextDueOn,
  };
}

export interface RecurringOccurrenceDto {
  id: number;
  recurringEntryId: number;
  ledger: Ledger;
  entryType: EntryType;
  item: string;
  amount: number;
  categoryId: number;
  categoryName: string;
  note: string | null;
  /** YYYY-MM-DD */
  dueOn: string;
}

export function toRecurringOccurrenceDto(
  occurrence: RecurringOccurrenceDetail,
): RecurringOccurrenceDto {
  return {
    id: occurrence.id,
    recurringEntryId: occurrence.recurringEntryId,
    ledger: occurrence.ledger,
    entryType: occurrence.entryType,
    item: occurrence.item,
    amount: occurrence.amount,
    categoryId: occurrence.categoryId,
    categoryName: occurrence.categoryName,
    note: occurrence.note,
    dueOn: occurrence.dueOn,
  };
}

export interface MonthTotalsDto {
  /** YYYY-MM */
  month: string;
  incomeTotal: number;
  expenseTotal: number;
  balance: number;
}

export interface AnnualReportDto {
  ledger: Ledger;
  year: number;
  incomeTotal: number;
  expenseTotal: number;
  balance: number;
  expenseByCategory: AnnualCategoryShareDto[];
  incomeByCategory: AnnualCategoryShareDto[];
  months: MonthTotalsDto[];
}

export interface AnnualCategoryShareDto extends ExpenseCategoryShareDto {
  /** 1–12 月金額（index 0 = 1 月） */
  monthlyAmounts: number[];
}

function toAnnualShareDto(share: AnnualCategoryShare): AnnualCategoryShareDto {
  return { ...toShareDto(share), monthlyAmounts: [...share.monthlyAmounts] };
}

export function toAnnualReportDto(report: AnnualReport): AnnualReportDto {
  return {
    ledger: report.ledger,
    year: report.year,
    incomeTotal: report.incomeTotal,
    expenseTotal: report.expenseTotal,
    balance: report.balance,
    expenseByCategory: report.expenseByCategory.map(toAnnualShareDto),
    incomeByCategory: report.incomeByCategory.map(toAnnualShareDto),
    months: report.months.map((month) => ({
      month: month.month,
      incomeTotal: month.incomeTotal,
      expenseTotal: month.expenseTotal,
      balance: month.balance,
    })),
  };
}
