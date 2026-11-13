/**
 * 每月固定收支（recurring_entries）與各期（recurring_occurrences）資料存取。
 * 日期以 'YYYY-MM-DD' 進出，只在此邊界轉換為 Date（R11）。
 */
import { formatDateOnly, parseDateOnly } from '../db/date-only';
import type { EntryType, Ledger } from '../domain/enums';
import type { DbClient } from './category-repository';

export type RecurringOccurrenceStatus = 'pending' | 'confirmed' | 'skipped';

export interface RecurringEntryFields {
  ledger: Ledger;
  entryType: EntryType;
  item: string;
  amount: number;
  categoryId: number;
  dayOfMonth: number;
  note: string | null;
  active: boolean;
}

export interface RecurringEntryDetail extends RecurringEntryFields {
  id: number;
  categoryName: string;
  /** YYYY-MM-DD */
  nextDueOn: string;
}

/** 某一期 + 所屬規則的顯示資料。 */
export interface RecurringOccurrenceDetail {
  id: number;
  recurringEntryId: number;
  ledger: Ledger;
  entryType: EntryType;
  item: string;
  /** 本期金額（產生時的快照） */
  amount: number;
  categoryId: number;
  categoryName: string;
  note: string | null;
  /** YYYY-MM-DD */
  dueOn: string;
  status: RecurringOccurrenceStatus;
}

const ENTRY_SELECT = {
  id: true,
  ledger: true,
  entryType: true,
  item: true,
  amount: true,
  categoryId: true,
  dayOfMonth: true,
  note: true,
  active: true,
  nextDueOn: true,
  category: { select: { name: true } },
} as const;

interface EntryRow extends RecurringEntryFields {
  id: number;
  nextDueOn: Date;
  category: { name: string };
}

function toEntryDetail(row: EntryRow): RecurringEntryDetail {
  const { category, nextDueOn, ...rest } = row;
  return { ...rest, categoryName: category.name, nextDueOn: formatDateOnly(nextDueOn) };
}

const OCCURRENCE_SELECT = {
  id: true,
  recurringEntryId: true,
  amount: true,
  dueOn: true,
  status: true,
  recurringEntry: {
    select: {
      ledger: true,
      entryType: true,
      item: true,
      categoryId: true,
      note: true,
      category: { select: { name: true } },
    },
  },
} as const;

interface OccurrenceRow {
  id: number;
  recurringEntryId: number;
  amount: number;
  dueOn: Date;
  status: RecurringOccurrenceStatus;
  recurringEntry: {
    ledger: Ledger;
    entryType: EntryType;
    item: string;
    categoryId: number;
    note: string | null;
    category: { name: string };
  };
}

function toOccurrenceDetail(row: OccurrenceRow): RecurringOccurrenceDetail {
  const entry = row.recurringEntry;
  return {
    id: row.id,
    recurringEntryId: row.recurringEntryId,
    ledger: entry.ledger,
    entryType: entry.entryType,
    item: entry.item,
    amount: row.amount,
    categoryId: entry.categoryId,
    categoryName: entry.category.name,
    note: entry.note,
    dueOn: formatDateOnly(row.dueOn),
    status: row.status,
  };
}

export class RecurringRepository {
  constructor(private readonly db: DbClient) {}

  /** 全部規則：啟用中在前 → 帳本 → 每月幾號 → id。 */
  async listEntries(): Promise<RecurringEntryDetail[]> {
    const rows = await this.db.recurringEntry.findMany({
      select: ENTRY_SELECT,
      orderBy: [{ active: 'desc' }, { ledger: 'asc' }, { dayOfMonth: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toEntryDetail);
  }

  async findEntry(id: number): Promise<RecurringEntryDetail | null> {
    const row = await this.db.recurringEntry.findUnique({ where: { id }, select: ENTRY_SELECT });
    return row ? toEntryDetail(row) : null;
  }

  async createEntry(
    input: RecurringEntryFields & { nextDueOn: string },
  ): Promise<RecurringEntryDetail> {
    const row = await this.db.recurringEntry.create({
      data: { ...input, nextDueOn: parseDateOnly(input.nextDueOn) },
      select: ENTRY_SELECT,
    });
    return toEntryDetail(row);
  }

  async updateEntry(
    id: number,
    input: RecurringEntryFields & { nextDueOn: string },
  ): Promise<RecurringEntryDetail> {
    const row = await this.db.recurringEntry.update({
      where: { id },
      data: { ...input, nextDueOn: parseDateOnly(input.nextDueOn) },
      select: ENTRY_SELECT,
    });
    return toEntryDetail(row);
  }

  /** @returns 是否有刪除 */
  async deleteEntry(id: number): Promise<boolean> {
    const result = await this.db.recurringEntry.deleteMany({ where: { id } });
    return result.count > 0;
  }

  /** 該規則已產生過的各期到期日（YYYY-MM-DD）。 */
  async listOccurrenceDueDates(recurringEntryId: number): Promise<string[]> {
    const rows = await this.db.recurringOccurrence.findMany({
      where: { recurringEntryId },
      select: { dueOn: true },
    });
    return rows.map((row) => formatDateOnly(row.dueOn));
  }

  /** 啟用中且下一次到期日不晚於 today 的規則 id。 */
  async listDueEntryIds(today: string): Promise<number[]> {
    const rows = await this.db.recurringEntry.findMany({
      where: { active: true, nextDueOn: { lte: parseDateOnly(today) } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  /** 鎖定規則列（交易內使用），回傳排程需要的欄位。 */
  async lockEntryForSchedule(
    id: number,
  ): Promise<{ amount: number; dayOfMonth: number; active: boolean; nextDueOn: string } | null> {
    const rows = await this.db.$queryRaw<
      { amount: number; day_of_month: number; active: boolean; next_due_on: Date }[]
    >`SELECT amount, day_of_month, active, next_due_on FROM recurring_entries WHERE id = ${id} FOR UPDATE`;
    const row = rows[0];
    if (!row) return null;
    return {
      amount: row.amount,
      dayOfMonth: row.day_of_month,
      active: row.active,
      nextDueOn: formatDateOnly(row.next_due_on),
    };
  }

  /** 建立一期（同規則同到期日已存在則略過）。 */
  async createOccurrence(recurringEntryId: number, dueOn: string, amount: number): Promise<void> {
    await this.db.recurringOccurrence.createMany({
      data: [{ recurringEntryId, dueOn: parseDateOnly(dueOn), amount }],
      skipDuplicates: true,
    });
  }

  async setNextDueOn(id: number, nextDueOn: string): Promise<void> {
    await this.db.recurringEntry.update({
      where: { id },
      data: { nextDueOn: parseDateOnly(nextDueOn) },
    });
  }

  /** 待確認的各期：到期日舊到新、同日 id 小到大。 */
  async listPendingOccurrences(): Promise<RecurringOccurrenceDetail[]> {
    const rows = await this.db.recurringOccurrence.findMany({
      where: { status: 'pending' },
      select: OCCURRENCE_SELECT,
      orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toOccurrenceDetail);
  }

  /** 尚未推播的待確認各期。 */
  async listUnnotifiedOccurrences(): Promise<RecurringOccurrenceDetail[]> {
    const rows = await this.db.recurringOccurrence.findMany({
      where: { status: 'pending', notifiedAt: null },
      select: OCCURRENCE_SELECT,
      orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toOccurrenceDetail);
  }

  async markNotified(ids: readonly number[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.db.recurringOccurrence.updateMany({
      where: { id: { in: [...ids] } },
      data: { notifiedAt: at },
    });
  }

  async findOccurrence(id: number): Promise<RecurringOccurrenceDetail | null> {
    const row = await this.db.recurringOccurrence.findUnique({
      where: { id },
      select: OCCURRENCE_SELECT,
    });
    return row ? toOccurrenceDetail(row) : null;
  }

  /**
   * 只在仍為 pending 時改變狀態（併發安全：同一期只會被處理一次）。
   * @returns 是否成功改變
   */
  async resolveIfPending(
    id: number,
    status: Exclude<RecurringOccurrenceStatus, 'pending'>,
    at: Date,
  ): Promise<boolean> {
    const result = await this.db.recurringOccurrence.updateMany({
      where: { id, status: 'pending' },
      data: { status, resolvedAt: at },
    });
    return result.count > 0;
  }

  async linkTransaction(id: number, transactionId: number): Promise<void> {
    await this.db.recurringOccurrence.update({ where: { id }, data: { transactionId } });
  }

  /** 分類被刪除時，規則改歸「其他」。 */
  async reassignCategory(fromCategoryId: number, toCategoryId: number): Promise<number> {
    const result = await this.db.recurringEntry.updateMany({
      where: { categoryId: fromCategoryId },
      data: { categoryId: toCategoryId },
    });
    return result.count;
  }
}
