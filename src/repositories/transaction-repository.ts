/**
 * 記帳紀錄資料存取（Repository）。日期以 'YYYY-MM-DD' 進出，只在此邊界轉換為 Date（R11）。
 */
import { Prisma } from '@prisma/client';
import type { EntrySource, EntryType, Ledger } from '../domain/enums';
import { formatDateOnly, parseDateOnly } from '../db/date-only';
import type { DbClient } from './category-repository';

export interface NewTransaction {
  ledger: Ledger;
  entryType: EntryType;
  item: string;
  amount: number;
  categoryId: number;
  /** YYYY-MM-DD（Asia/Taipei） */
  occurredOn: string;
  note: string | null;
  source: EntrySource;
}

/** 刪除流程顯示用的紀錄摘要。 */
export interface TransactionSummary {
  id: number;
  item: string;
  amount: number;
  /** YYYY-MM-DD */
  occurredOn: string;
}

const SUMMARY_SELECT = { id: true, item: true, amount: true, occurredOn: true } as const;

interface SummaryRow {
  id: number;
  item: string;
  amount: number;
  occurredOn: Date;
}

function toSummary(row: SummaryRow): TransactionSummary {
  return {
    id: row.id,
    item: row.item,
    amount: row.amount,
    occurredOn: formatDateOnly(row.occurredOn),
  };
}

/** 依 (收支, 分類) 彙總的金額。 */
export interface CategoryAmountTotal {
  entryType: EntryType;
  categoryId: number;
  amount: number;
}

/** 'YYYY-MM-DD' 半開區間 [start, endExclusive)。 */
export interface DateOnlyRange {
  start: string;
  endExclusive: string;
}

/** Prisma「操作的紀錄不存在」（delete / update 找不到列）。 */
function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

export class TransactionRepository {
  constructor(private readonly db: DbClient) {}

  /** 新增一筆記帳紀錄，回傳其 id。 */
  async create(input: NewTransaction): Promise<{ id: number }> {
    return this.db.transaction.create({
      data: {
        ledger: input.ledger,
        entryType: input.entryType,
        item: input.item,
        amount: input.amount,
        categoryId: input.categoryId,
        occurredOn: parseDateOnly(input.occurredOn),
        note: input.note,
        source: input.source,
      },
      select: { id: true },
    });
  }

  /** 依 id 取紀錄摘要；不存在回 null。 */
  async findSummaryById(id: number): Promise<TransactionSummary | null> {
    const row = await this.db.transaction.findUnique({ where: { id }, select: SUMMARY_SELECT });
    return row ? toSummary(row) : null;
  }

  /**
   * 以單一 DELETE 刪除並回傳被刪除列的摘要（不先查再刪，避免 TOCTOU）。
   * 紀錄不存在（P2025）回 null；其他例外原樣拋出。
   */
  async deleteById(id: number): Promise<TransactionSummary | null> {
    try {
      const row = await this.db.transaction.delete({ where: { id }, select: SUMMARY_SELECT });
      return toSummary(row);
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /** 指定帳本、日期區間 [start, endExclusive) 內，依 (收支, 分類) 彙總金額。 */
  async sumByCategory(ledger: Ledger, range: DateOnlyRange): Promise<CategoryAmountTotal[]> {
    const groups = await this.db.transaction.groupBy({
      by: ['entryType', 'categoryId'],
      where: {
        ledger,
        occurredOn: { gte: parseDateOnly(range.start), lt: parseDateOnly(range.endExclusive) },
      },
      _sum: { amount: true },
      orderBy: [{ entryType: 'asc' }, { categoryId: 'asc' }],
    });
    return groups.map((group) => ({
      entryType: group.entryType,
      categoryId: group.categoryId,
      amount: group._sum.amount ?? 0,
    }));
  }

  /** 將指向 fromCategoryId 的全部紀錄改指向 toCategoryId，回傳更新筆數。 */
  async reassignCategory(fromCategoryId: number, toCategoryId: number): Promise<number> {
    const result = await this.db.transaction.updateMany({
      where: { categoryId: fromCategoryId },
      data: { categoryId: toCategoryId },
    });
    return result.count;
  }
}
