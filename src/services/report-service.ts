/**
 * 月度報表查詢（implementation-plan P5-3；P7 GET /api/reports/monthly 直接重用）。
 *
 * getMonthlyReport：monthRange(month) → 依 (收支, 分類) groupBy 金額 → join 分類名稱
 *   → buildMonthlyReport（純計算：合計、結餘、佔比、排序）。
 * 本 service 只負責 I/O 與組裝，計算規則全部在 src/domain/monthly-report.ts。
 */
import type { PrismaClient } from '@prisma/client';
import { buildAnnualReport, type AnnualReport } from '../domain/annual-report';
import { monthRange, yearRange } from '../domain/date-utils';
import type { Ledger } from '../domain/enums';
import {
  buildMonthlyReport,
  type CategoryTotalRow,
  type MonthlyReport,
} from '../domain/monthly-report';
import { CategoryRepository } from '../repositories/category-repository';
import { TransactionRepository } from '../repositories/transaction-repository';

export class ReportService {
  private readonly transactions: TransactionRepository;
  private readonly categories: CategoryRepository;

  constructor(prisma: PrismaClient) {
    this.transactions = new TransactionRepository(prisma);
    this.categories = new CategoryRepository(prisma);
  }

  /**
   * 指定帳本、月份（'YYYY-MM'，Asia/Taipei 日期）的月度報表。
   * @throws RangeError month 格式不合法（呼叫端應先以 parseMonth / schema 驗證）
   */
  async getMonthlyReport(ledger: Ledger, month: string): Promise<MonthlyReport> {
    const totals = await this.transactions.sumByCategory(ledger, monthRange(month));
    const names = await this.categories.findNamesByIds(totals.map((total) => total.categoryId));

    const rows: CategoryTotalRow[] = totals.map((total) => ({
      ...total,
      // categoryId 有 FK 約束，正常情況必有名稱；防禦性以 id 字串代替
      categoryName: names.get(total.categoryId) ?? `#${total.categoryId}`,
    }));
    return buildMonthlyReport({ ledger, month, rows });
  }

  /** 指定帳本、年度（Asia/Taipei 日期）的年度報表：合計、分類佔比、12 個月收支。 */
  async getAnnualReport(ledger: Ledger, year: number): Promise<AnnualReport> {
    const range = yearRange(year);
    const [totals, monthRows] = await Promise.all([
      this.transactions.sumByCategory(ledger, range),
      this.transactions.sumByMonth(ledger, range),
    ]);
    const names = await this.categories.findNamesByIds(totals.map((total) => total.categoryId));
    const categoryRows: CategoryTotalRow[] = totals.map((total) => ({
      ...total,
      categoryName: names.get(total.categoryId) ?? `#${total.categoryId}`,
    }));
    return buildAnnualReport({ ledger, year, categoryRows, monthRows });
  }
}
