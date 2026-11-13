/**
 * LINE 批次記帳的待分類項目（Repository）。日期以 'YYYY-MM-DD' 進出，只在此邊界轉換為 Date（R11）。
 */
import type { EntryType, Ledger } from '../domain/enums';
import { formatDateOnly, parseDateOnly } from '../db/date-only';
import type { DbClient } from './category-repository';

export interface NewPendingEntry {
  batchId: string;
  seq: number;
  ledger: Ledger;
  entryType: EntryType;
  item: string;
  amount: number;
  /** YYYY-MM-DD */
  occurredOn: string;
  note: string | null;
}

export interface PendingEntry extends NewPendingEntry {
  id: number;
}

const PENDING_SELECT = {
  id: true,
  batchId: true,
  seq: true,
  ledger: true,
  entryType: true,
  item: true,
  amount: true,
  occurredOn: true,
  note: true,
} as const;

type PendingRow = Omit<PendingEntry, 'occurredOn'> & { occurredOn: Date };

function toPending(row: PendingRow): PendingEntry {
  return { ...row, occurredOn: formatDateOnly(row.occurredOn) };
}

export class PendingEntryRepository {
  constructor(private readonly db: DbClient) {}

  async createMany(entries: readonly NewPendingEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.db.pendingEntry.createMany({
      data: entries.map((entry) => ({ ...entry, occurredOn: parseDateOnly(entry.occurredOn) })),
    });
  }

  async findById(id: number): Promise<PendingEntry | null> {
    const row = await this.db.pendingEntry.findUnique({ where: { id }, select: PENDING_SELECT });
    return row ? toPending(row) : null;
  }

  /** 刪除一筆；回傳是否真的刪到（併發時只有一方為 true）。 */
  async deleteById(id: number): Promise<boolean> {
    const result = await this.db.pendingEntry.deleteMany({ where: { id } });
    return result.count > 0;
  }

  /** 同批次剩餘項目，依 seq 升冪。 */
  async listByBatch(batchId: string): Promise<PendingEntry[]> {
    const rows = await this.db.pendingEntry.findMany({
      where: { batchId },
      orderBy: [{ seq: 'asc' }, { id: 'asc' }],
      select: PENDING_SELECT,
    });
    return rows.map(toPending);
  }

  /** 全部待分類中最早的一筆（批次建立先後 → seq）。 */
  async findOldest(): Promise<PendingEntry | null> {
    const row = await this.db.pendingEntry.findFirst({
      orderBy: [{ createdAt: 'asc' }, { batchId: 'asc' }, { seq: 'asc' }, { id: 'asc' }],
      select: PENDING_SELECT,
    });
    return row ? toPending(row) : null;
  }

  /** 刪除 createdAt 早於 before 的項目（逾期清理），回傳筆數。 */
  async deleteCreatedBefore(before: Date): Promise<number> {
    const result = await this.db.pendingEntry.deleteMany({ where: { createdAt: { lt: before } } });
    return result.count;
  }
}
