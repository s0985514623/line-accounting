/**
 * 每月固定收支業務邏輯。
 *
 * 規則 CRUD（LIFF）：
 *  - 分類必須存在且帳本、收支一致（NOT_FOUND / CATEGORY_MISMATCH）。
 *  - 新增：nextDueOn = 從今天起第一個到期日（今天到期 → 今天）。
 *  - 編輯：改了每月幾號，或由停用改為啟用 → 重新計算 nextDueOn；已產生過的月份不重複產生。
 *  - 刪除：硬刪除規則與各期；已入帳的記帳紀錄保留。
 *
 * 排程（generateDue）：每條啟用中、nextDueOn ≤ 今天的規則，於單一交易內鎖定該列，
 *  逐月補產生 pending 的各期（金額快照），並推進 nextDueOn。同規則同到期日唯一，重複執行安全。
 *
 * 各期處理（LINE 按鈕 / LIFF）：
 *  - confirm：仍為 pending 才改為 confirmed，並以規則的項目 / 分類 / 備註、本期到期日寫入記帳紀錄；
 *    amount 有給就用新金額，否則用本期金額。
 *  - skip：仍為 pending 才改為 skipped，不寫入記帳紀錄。
 *  - 已處理過 → alreadyResolved；不存在 → notFound（皆不寫入）。
 */
import type { PrismaClient } from '@prisma/client';
import { todayInTaipei } from '../domain/date-utils';
import type { EntrySource } from '../domain/enums';
import { DomainError } from '../domain/errors';
import { isValidRecordId } from '../domain/record-id';
import { firstDueOnOrAfter, monthOf, nextDueOn } from '../domain/recurring-schedule';
import type { Clock } from '../ports/clock';
import { CategoryRepository } from '../repositories/category-repository';
import {
  RecurringRepository,
  type RecurringEntryDetail,
  type RecurringEntryFields,
  type RecurringOccurrenceDetail,
  type RecurringOccurrenceStatus,
} from '../repositories/recurring-repository';
import {
  TransactionRepository,
  type TransactionDetail,
} from '../repositories/transaction-repository';

const ENTRY_NOT_FOUND_MESSAGE = '固定收支不存在';
const CATEGORY_NOT_FOUND_MESSAGE = '分類不存在';
const CATEGORY_MISMATCH_MESSAGE = '分類與帳本或收支不符';

export type RecurringEntryInput = RecurringEntryFields;

export type ConfirmOccurrenceResult =
  | {
      kind: 'confirmed';
      occurrence: RecurringOccurrenceDetail;
      transaction: TransactionDetail;
    }
  | { kind: 'alreadyResolved'; status: RecurringOccurrenceStatus }
  | { kind: 'notFound' };

export type SkipOccurrenceResult =
  | { kind: 'skipped'; occurrence: RecurringOccurrenceDetail }
  | { kind: 'alreadyResolved'; status: RecurringOccurrenceStatus }
  | { kind: 'notFound' };

export interface RecurringServiceDeps {
  prisma: PrismaClient;
  clock: Clock;
}

/** 從 from 起第一個「還沒產生過」的到期日。 */
function nextFreeDueOn(dayOfMonth: number, from: string, existing: readonly string[]): string {
  const usedMonths = new Set(existing.map(monthOf));
  let due = firstDueOnOrAfter(dayOfMonth, from);
  while (usedMonths.has(monthOf(due))) due = nextDueOn(due, dayOfMonth);
  return due;
}

export class RecurringService {
  private readonly repo: RecurringRepository;

  constructor(private readonly deps: RecurringServiceDeps) {
    this.repo = new RecurringRepository(deps.prisma);
  }

  private today(): string {
    return todayInTaipei(this.deps.clock.now());
  }

  // ---- 規則 CRUD ------------------------------------------------------------------------------

  listEntries(): Promise<RecurringEntryDetail[]> {
    return this.repo.listEntries();
  }

  /** @throws DomainError NOT_FOUND、CATEGORY_MISMATCH */
  async createEntry(input: RecurringEntryInput): Promise<RecurringEntryDetail> {
    await this.requireMatchingCategory(input);
    return this.repo.createEntry({
      ...input,
      nextDueOn: firstDueOnOrAfter(input.dayOfMonth, this.today()),
    });
  }

  /** @throws DomainError NOT_FOUND、CATEGORY_MISMATCH */
  async updateEntry(id: number, input: RecurringEntryInput): Promise<RecurringEntryDetail> {
    const current = isValidRecordId(id) ? await this.repo.findEntry(id) : null;
    if (!current) throw new DomainError('NOT_FOUND', ENTRY_NOT_FOUND_MESSAGE);
    await this.requireMatchingCategory(input);

    const reschedule = input.dayOfMonth !== current.dayOfMonth || (input.active && !current.active);
    const next = reschedule
      ? nextFreeDueOn(input.dayOfMonth, this.today(), await this.repo.listOccurrenceDueDates(id))
      : current.nextDueOn;
    return this.repo.updateEntry(id, { ...input, nextDueOn: next });
  }

  /** @throws DomainError NOT_FOUND */
  async deleteEntry(id: number): Promise<void> {
    const deleted = isValidRecordId(id) && (await this.repo.deleteEntry(id));
    if (!deleted) throw new DomainError('NOT_FOUND', ENTRY_NOT_FOUND_MESSAGE);
  }

  // ---- 排程 -----------------------------------------------------------------------------------

  /**
   * 產生所有到期（≤ today）的各期。
   * @returns 新推進的規則數
   */
  async generateDue(today: string = this.today()): Promise<number> {
    let advanced = 0;
    for (const id of await this.repo.listDueEntryIds(today)) {
      const didAdvance = await this.deps.prisma.$transaction(async (tx) => {
        const repo = new RecurringRepository(tx);
        const entry = await repo.lockEntryForSchedule(id);
        if (!entry || !entry.active || entry.nextDueOn > today) return false;
        let due = entry.nextDueOn;
        while (due <= today) {
          await repo.createOccurrence(id, due, entry.amount);
          due = nextDueOn(due, entry.dayOfMonth);
        }
        await repo.setNextDueOn(id, due);
        return true;
      });
      if (didAdvance) advanced += 1;
    }
    return advanced;
  }

  listPendingOccurrences(): Promise<RecurringOccurrenceDetail[]> {
    return this.repo.listPendingOccurrences();
  }

  listUnnotifiedOccurrences(): Promise<RecurringOccurrenceDetail[]> {
    return this.repo.listUnnotifiedOccurrences();
  }

  markNotified(ids: readonly number[]): Promise<void> {
    return this.repo.markNotified(ids, this.deps.clock.now());
  }

  // ---- 各期處理 -------------------------------------------------------------------------------

  async confirmOccurrence(
    id: number,
    options: { amount?: number; source: EntrySource },
  ): Promise<ConfirmOccurrenceResult> {
    if (!isValidRecordId(id)) return { kind: 'notFound' };
    return this.deps.prisma.$transaction(async (tx): Promise<ConfirmOccurrenceResult> => {
      const repo = new RecurringRepository(tx);
      const occurrence = await repo.findOccurrence(id);
      if (!occurrence) return { kind: 'notFound' };
      if (!(await repo.resolveIfPending(id, 'confirmed', this.deps.clock.now()))) {
        return { kind: 'alreadyResolved', status: occurrence.status };
      }
      const transaction = await new TransactionRepository(tx).createDetailed({
        ledger: occurrence.ledger,
        entryType: occurrence.entryType,
        item: occurrence.item,
        amount: options.amount ?? occurrence.amount,
        categoryId: occurrence.categoryId,
        occurredOn: occurrence.dueOn,
        note: occurrence.note,
        source: options.source,
      });
      await repo.linkTransaction(id, transaction.id);
      return { kind: 'confirmed', occurrence: { ...occurrence, status: 'confirmed' }, transaction };
    });
  }

  async skipOccurrence(id: number): Promise<SkipOccurrenceResult> {
    if (!isValidRecordId(id)) return { kind: 'notFound' };
    const occurrence = await this.repo.findOccurrence(id);
    if (!occurrence) return { kind: 'notFound' };
    if (!(await this.repo.resolveIfPending(id, 'skipped', this.deps.clock.now()))) {
      return { kind: 'alreadyResolved', status: occurrence.status };
    }
    return { kind: 'skipped', occurrence: { ...occurrence, status: 'skipped' } };
  }

  // ---- 內部 -----------------------------------------------------------------------------------

  private async requireMatchingCategory(input: RecurringEntryInput): Promise<void> {
    const category = isValidRecordId(input.categoryId)
      ? await new CategoryRepository(this.deps.prisma).findById(input.categoryId)
      : null;
    if (!category) throw new DomainError('NOT_FOUND', CATEGORY_NOT_FOUND_MESSAGE);
    if (category.ledger !== input.ledger || category.entryType !== input.entryType) {
      throw new DomainError('CATEGORY_MISMATCH', CATEGORY_MISMATCH_MESSAGE);
    }
  }
}
