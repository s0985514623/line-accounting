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
}
