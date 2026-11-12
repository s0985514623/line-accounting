/**
 * 文字記帳的分類比對：限同帳本同收支，名稱完全相等優先，其次為已學習關鍵字（完全相等）。
 * 依據：specs/features/transaction/以文字訊息記帳.feature「比對順序」。
 */
import type { EntryType, Ledger } from '../domain/enums';
import type { CategoryRepository, CategorySummary } from '../repositories/category-repository';
import type { KeywordRepository } from '../repositories/keyword-repository';

export class CategoryMatcher {
  constructor(
    private readonly categories: Pick<CategoryRepository, 'findByName'>,
    private readonly keywords: Pick<KeywordRepository, 'findCategoryByKeyword'>,
  ) {}

  /** 回傳命中的分類；對應不到時回 null。 */
  async match(ledger: Ledger, entryType: EntryType, item: string): Promise<CategorySummary | null> {
    return (
      (await this.categories.findByName(ledger, entryType, item)) ??
      (await this.keywords.findCategoryByKeyword(ledger, entryType, item))
    );
  }
}
