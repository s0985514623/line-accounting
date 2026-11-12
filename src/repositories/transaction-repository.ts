/**
 * 記帳紀錄資料存取（Repository）。日期以 'YYYY-MM-DD' 進出，只在此邊界轉換為 Date（R11）。
 */
import type { EntrySource, EntryType, Ledger } from '../domain/enums';
import { parseDateOnly } from '../db/date-only';
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
}
