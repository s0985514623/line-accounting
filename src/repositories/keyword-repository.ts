/**
 * 分類關鍵字資料存取（Repository）。關鍵字的 ledger / entryType 冗餘自分類，
 * 唯一約束為 ledger × entryType × keyword。
 */
import type { EntryType, Ledger } from '../domain/enums';
import type { CategorySummary, DbClient } from './category-repository';

export class KeywordRepository {
  constructor(private readonly db: DbClient) {}

  /** 同帳本同收支、關鍵字完全相等時，回傳其指向的分類；否則 null。 */
  async findCategoryByKeyword(
    ledger: Ledger,
    entryType: EntryType,
    keyword: string,
  ): Promise<CategorySummary | null> {
    const row = await this.db.categoryKeyword.findUnique({
      where: { ledger_entryType_keyword: { ledger, entryType, keyword } },
      select: { category: { select: { id: true, name: true, isFallback: true } } },
    });
    return row?.category ?? null;
  }

  /** 建立或改指向關鍵字（唯一鍵 ledger × entryType × keyword）：已存在則改指向 categoryId。 */
  async upsert(
    ledger: Ledger,
    entryType: EntryType,
    keyword: string,
    categoryId: number,
  ): Promise<void> {
    await this.db.categoryKeyword.upsert({
      where: { ledger_entryType_keyword: { ledger, entryType, keyword } },
      create: { ledger, entryType, keyword, categoryId },
      update: { categoryId },
      select: { id: true },
    });
  }
}
