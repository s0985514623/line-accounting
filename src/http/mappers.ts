/**
 * Repository 資料 → API DTO（specs/api/api.yml components/schemas）。
 */
import type { EntrySource, EntryType, Ledger } from '../domain/enums';
import type { CategoryShare, MonthlyReport } from '../domain/monthly-report';
import type { CategoryDetail } from '../repositories/category-repository';
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
