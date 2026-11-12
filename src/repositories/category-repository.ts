/**
 * 分類資料存取（Repository）。以 PrismaClient 或交易內的 TransactionClient 建立，
 * 由 service 決定交易邊界。
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { DefaultCategory } from '../domain/default-categories';

export type DbClient = PrismaClient | Prisma.TransactionClient;

export class CategoryRepository {
  constructor(private readonly db: DbClient) {}

  /** 全部分類數量（不分帳本、收支）。 */
  count(): Promise<number> {
    return this.db.category.count();
  }

  /**
   * 依傳入順序批次建立分類；與既有唯一約束衝突者略過（併發 follow 時不報錯）。
   * @returns 實際建立筆數
   */
  async createMany(categories: readonly DefaultCategory[]): Promise<number> {
    const result = await this.db.category.createMany({
      data: categories.map(({ ledger, entryType, name, isFallback }) => ({
        ledger,
        entryType,
        name,
        isFallback,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }
}
