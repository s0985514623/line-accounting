/**
 * 記帳業務邏輯。
 *
 * createFromText（implementation-plan P3-5、DF-1）：
 *  1. 系統中沒有任何分類時先建立預設分類（ASM-08）。
 *  2. 同帳本同收支比對分類：名稱 → 關鍵字。
 *  3. 命中 → 寫入一筆 LINE 文字記帳（日期為 Asia/Taipei 的今天）；不學關鍵字、不寫 postback token。
 *  4. 未命中 → 不寫入任何資料，回傳該組分類（依 id 升冪）與新的一次性 token，供回覆分類按鈕（無狀態草稿）。
 *
 * completePick（implementation-plan P3-5、DF-2；選擇分類完成記帳.feature）：
 *  單一 prisma.$transaction（callback 形式），交易內順序固定：
 *  token 查重 → 分類驗證 → insert token → insert transaction（日期取 payload.date）
 *  → 回填 token.transactionId → 非 fallback 分類才 upsert 關鍵字。
 *  - token 已使用優先回 alreadyUsed；分類錯誤（不存在 / 帳本或收支不符）只讀不寫，token 不被消耗。
 *  - 併發時 insert token 撞 PK（P2002）→ 整段 rollback 並回 alreadyUsed；其他例外原樣拋出。
 *
 * createBatchFromText / completeBatchPick / resumePending（LINE 多行批次記帳）：
 *  - 批次：單一交易內逐行比對分類，命中即寫入；未命中寫入 pending_entries（同 batchId、seq = 行號）。
 *    同時清掉超過 PENDING_TTL_DAYS 的舊待分類項目。回傳已記帳清單與第一筆待分類的分類選項。
 *  - 選分類（action=bpick）：單一交易內 查 pending（不存在 → alreadyUsed）→ 分類驗證（失敗不消耗）
 *    → 刪 pending → 寫入紀錄 → 非 fallback 分類學關鍵字 → 同批次剩餘項目重新比對
 *    （剛學到的關鍵字可直接命中），命中者自動記帳，遇到第一筆仍未命中者停下，回傳其分類選項。
 *  - resumePending（「待分類」指令）：回傳最早一筆待分類項目的分類選項。
 *
 * findSummaryById / deleteById（implementation-plan P4；確認刪除記帳紀錄.feature）：
 *  - id 不是 1..int4 上限的整數 → 視為不存在，不碰資料庫。
 *  - deleteById 只執行一次 DELETE（以被刪除列組成結果）；P2025 → notFound，其他例外原樣拋出。
 *
 * LIFF 表單 CRUD（implementation-plan P7-2、DF-3；以表單記帳 / 編輯 / 刪除 / 查詢記帳紀錄列表.feature）：
 *  失敗一律拋 DomainError，由 http error-handler 轉成 api.yml 的 Error 形狀。
 *  - createFromForm：分類存在（否則 NOT_FOUND）且帳本、收支一致（否則 CATEGORY_MISMATCH）→ 寫入（source = liff_form）。
 *  - updateFromForm：紀錄存在 → 分類檢查 → 全欄位更新（source 不變）；任何檢查失敗皆不寫入。
 *  - deleteFromForm：同 deleteById，不存在 → NOT_FOUND。
 *  - listByMonth：指定帳本與月份，日期新到舊、同日 id 大到小。
 *  - 檢查後才被併發刪除：分類（FK P2003）/ 紀錄（P2025）→ NOT_FOUND。
 */
import { randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { monthRange, todayInTaipei } from '../domain/date-utils';
import type { EntryType, Ledger } from '../domain/enums';
import { DomainError } from '../domain/errors';
import type { PickPayload } from '../domain/postback-codec';
import { isValidRecordId } from '../domain/record-id';
import type { TextEntry } from '../domain/text-entry-parser';
import type { Clock } from '../ports/clock';
import { CategoryRepository, type CategorySummary } from '../repositories/category-repository';
import { KeywordRepository } from '../repositories/keyword-repository';
import {
  PendingEntryRepository,
  type NewPendingEntry,
  type PendingEntry,
} from '../repositories/pending-entry-repository';
import { PostbackTokenRepository } from '../repositories/postback-token-repository';
import {
  TransactionRepository,
  type TransactionDetail,
  type TransactionSummary,
  type TransactionUpdate,
} from '../repositories/transaction-repository';
import { CategoryMatcher } from './category-matcher';
import type { EnsureDefaultCategoriesResult } from './onboarding-service';

/** 分類按鈕 token 的隨機位元組數：9 bytes → base64url 12 字元（implementation-plan P3-3）。 */
const PICK_TOKEN_BYTES = 9;

/** 產生一次性分類按鈕 token。 */
export function generatePickToken(): string {
  return randomBytes(PICK_TOKEN_BYTES).toString('base64url');
}

export interface DefaultCategoriesProvider {
  ensureDefaultCategories(): Promise<EnsureDefaultCategoriesResult>;
}

export type TextEntryInput = Omit<TextEntry, 'kind' | 'date'> & {
  /** YYYY-MM-DD；省略 = Asia/Taipei 的今天 */
  occurredOn?: string;
};

/** 批次中的一行（已解析、日期已換算）。 */
export type BatchEntryInput = Omit<TextEntry, 'kind' | 'date'> & {
  /** 原訊息行號（1 起算），決定詢問分類的順序 */
  line: number;
  /** YYYY-MM-DD */
  occurredOn: string;
};

/** 待分類項目保留天數；逾期於下次批次記帳時清除。 */
export const PENDING_TTL_DAYS = 7;

/** 已寫入的一筆記帳（批次回覆用）。 */
export interface RecordedEntry {
  transactionId: number;
  ledger: Ledger;
  entryType: EntryType;
  item: string;
  amount: number;
  categoryName: string;
  /** YYYY-MM-DD */
  occurredOn: string;
}

/** 下一筆待分類項目與其可選分類。 */
export interface PendingPrompt {
  pendingId: number;
  ledger: Ledger;
  entryType: EntryType;
  item: string;
  amount: number;
  /** YYYY-MM-DD */
  occurredOn: string;
  /** 同批次尚待分類的筆數（含本筆） */
  remaining: number;
  /** 同帳本同收支的分類，依 id 升冪 */
  categories: CategorySummary[];
}

export interface BatchResult {
  /** 依行號順序 */
  recorded: RecordedEntry[];
  pendingCount: number;
  next: PendingPrompt | null;
}

export type CompleteBatchPickResult =
  | {
      kind: 'recorded';
      picked: RecordedEntry;
      /** 同批次後續項目因剛學到的關鍵字而自動記帳者 */
      autoRecorded: RecordedEntry[];
      next: PendingPrompt | null;
    }
  /** 項目已記帳（重複點擊、併發） */
  | { kind: 'alreadyUsed' }
  | { kind: 'categoryNotFound' }
  | { kind: 'categoryMismatch' };

export type CreateFromTextResult =
  | {
      kind: 'recorded';
      transactionId: number;
      categoryName: string;
      /** YYYY-MM-DD */
      occurredOn: string;
    }
  | {
      kind: 'needsCategory';
      token: string;
      /** YYYY-MM-DD */
      date: string;
      /** 同帳本同收支的分類，依 id 升冪 */
      categories: CategorySummary[];
    };

export type CompletePickResult =
  | {
      kind: 'recorded';
      transactionId: number;
      categoryName: string;
      /** YYYY-MM-DD */
      occurredOn: string;
    }
  /** token 已使用（查重命中，或併發 insert token 撞 PK） */
  | { kind: 'alreadyUsed' }
  /** categoryId 不存在 */
  | { kind: 'categoryNotFound' }
  /** 分類存在但帳本或收支與 payload 不符 */
  | { kind: 'categoryMismatch' };

export type { TransactionDetail, TransactionSummary };

/** LIFF 表單的記帳輸入（全欄位；已由 http schema 驗證格式）。 */
export type FormTransactionInput = TransactionUpdate;

const TRANSACTION_NOT_FOUND_MESSAGE = '記帳紀錄不存在';
const CATEGORY_NOT_FOUND_MESSAGE = '分類不存在';
const CATEGORY_MISMATCH_MESSAGE = '分類不屬於所選帳本與收支';

export type DeleteByIdResult =
  | {
      kind: 'deleted';
      item: string;
      amount: number;
      /** YYYY-MM-DD */
      occurredOn: string;
    }
  /** 紀錄不存在（含 id 不合法、重複確認刪除） */
  | { kind: 'notFound' };

/** 交易內刪 pending 時已被併發刪除，用來 rollback 後轉成 alreadyUsed。 */
class PendingConflictError extends Error {
  constructor() {
    super('pending entry already consumed (concurrent pick)');
    this.name = 'PendingConflictError';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 交易內 insert token 撞 PK 時拋出，用來讓整段交易 rollback 後轉成 alreadyUsed。 */
class PickTokenConflictError extends Error {
  constructor() {
    super('postback token already used (concurrent insert)');
    this.name = 'PickTokenConflictError';
  }
}

function isPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function isUniqueViolation(error: unknown): boolean {
  return isPrismaError(error, 'P2002');
}

/** FK 違反：檢查通過後分類才被併發刪除。 */
function isForeignKeyViolation(error: unknown): boolean {
  return isPrismaError(error, 'P2003');
}

export interface TransactionServiceDeps {
  prisma: PrismaClient;
  clock: Clock;
  onboarding: DefaultCategoriesProvider;
  /** 測試可注入；預設 generatePickToken */
  generateToken?: () => string;
}

export class TransactionService {
  private readonly categories: CategoryRepository;
  private readonly transactions: TransactionRepository;
  private readonly matcher: CategoryMatcher;
  private readonly generateToken: () => string;

  constructor(private readonly deps: TransactionServiceDeps) {
    this.categories = new CategoryRepository(deps.prisma);
    this.transactions = new TransactionRepository(deps.prisma);
    this.matcher = new CategoryMatcher(this.categories, new KeywordRepository(deps.prisma));
    this.generateToken = deps.generateToken ?? generatePickToken;
  }

  /** 以解析後的文字記帳：命中分類即記帳，否則回傳分類選擇所需資料（不寫入）。 */
  async createFromText(entry: TextEntryInput): Promise<CreateFromTextResult> {
    const today = entry.occurredOn ?? todayInTaipei(this.deps.clock.now());
    await this.ensureCategoriesExist();

    const category = await this.matcher.match(entry.ledger, entry.entryType, entry.item);
    if (!category) {
      return {
        kind: 'needsCategory',
        token: this.generateToken(),
        date: today,
        categories: await this.categories.listByGroup(entry.ledger, entry.entryType),
      };
    }

    const { id } = await this.transactions.create({
      ledger: entry.ledger,
      entryType: entry.entryType,
      item: entry.item,
      amount: entry.amount,
      categoryId: category.id,
      occurredOn: today,
      note: entry.note,
      source: 'line_text',
    });
    return { kind: 'recorded', transactionId: id, categoryName: category.name, occurredOn: today };
  }

  /** LINE 多行批次記帳：命中分類者直接寫入，其餘存成待分類並回傳第一筆的分類選項。 */
  async createBatchFromText(entries: readonly BatchEntryInput[]): Promise<BatchResult> {
    await this.ensureCategoriesExist();
    const batchId = this.generateToken();
    const expiredBefore = new Date(this.deps.clock.now().getTime() - PENDING_TTL_DAYS * DAY_MS);

    return this.deps.prisma.$transaction(async (tx) => {
      const pendingRepo = new PendingEntryRepository(tx);
      await pendingRepo.deleteCreatedBefore(expiredBefore);

      const matcher = this.matcherFor(tx);
      const transactions = new TransactionRepository(tx);
      const recorded: RecordedEntry[] = [];
      const pending: NewPendingEntry[] = [];
      for (const entry of [...entries].sort((a, b) => a.line - b.line)) {
        const category = await matcher.match(entry.ledger, entry.entryType, entry.item);
        if (!category) {
          pending.push({
            batchId,
            seq: entry.line,
            ledger: entry.ledger,
            entryType: entry.entryType,
            item: entry.item,
            amount: entry.amount,
            occurredOn: entry.occurredOn,
            note: entry.note,
          });
          continue;
        }
        recorded.push(await this.recordMatched(transactions, entry, category));
      }
      await pendingRepo.createMany(pending);

      const remaining = await pendingRepo.listByBatch(batchId);
      return {
        recorded,
        pendingCount: remaining.length,
        next: await this.buildPrompt(tx, remaining),
      };
    });
  }

  /** 批次待分類項目選定分類（全程單一交易）。 */
  async completeBatchPick(pendingId: number, categoryId: number): Promise<CompleteBatchPickResult> {
    if (!isValidRecordId(pendingId)) return { kind: 'alreadyUsed' };
    try {
      return await this.deps.prisma.$transaction((tx) =>
        this.completeBatchPickInTransaction(tx, pendingId, categoryId),
      );
    } catch (error) {
      if (error instanceof PendingConflictError) return { kind: 'alreadyUsed' };
      throw error;
    }
  }

  /** 「待分類」指令：最早一筆待分類項目的分類選項；沒有則 null。 */
  async resumePending(): Promise<PendingPrompt | null> {
    const pendingRepo = new PendingEntryRepository(this.deps.prisma);
    const oldest = await pendingRepo.findOldest();
    if (!oldest) return null;
    return this.buildPrompt(this.deps.prisma, await pendingRepo.listByBatch(oldest.batchId));
  }

  private async completeBatchPickInTransaction(
    tx: Prisma.TransactionClient,
    pendingId: number,
    categoryId: number,
  ): Promise<CompleteBatchPickResult> {
    const pendingRepo = new PendingEntryRepository(tx);
    const entry = await pendingRepo.findById(pendingId);
    if (!entry) return { kind: 'alreadyUsed' };

    const category = isValidRecordId(categoryId)
      ? await new CategoryRepository(tx).findById(categoryId)
      : null;
    if (!category) return { kind: 'categoryNotFound' };
    if (category.ledger !== entry.ledger || category.entryType !== entry.entryType) {
      return { kind: 'categoryMismatch' };
    }

    if (!(await pendingRepo.deleteById(entry.id))) throw new PendingConflictError();
    const transactions = new TransactionRepository(tx);
    const picked = await this.recordMatched(transactions, entry, category);
    if (!category.isFallback) {
      await new KeywordRepository(tx).upsert(
        entry.ledger,
        entry.entryType,
        entry.item,
        category.id,
      );
    }

    // 同批次剩餘項目依序重新比對：剛學到的關鍵字可能讓緊接著的項目直接命中；
    // 遇到第一筆仍未命中者即停止（之後的留待下一輪，維持「依序」詢問）。
    const matcher = this.matcherFor(tx);
    const autoRecorded: RecordedEntry[] = [];
    const remaining: PendingEntry[] = [];
    for (const next of await pendingRepo.listByBatch(entry.batchId)) {
      const matched =
        remaining.length === 0 ? await matcher.match(next.ledger, next.entryType, next.item) : null;
      if (matched) {
        if (!(await pendingRepo.deleteById(next.id))) throw new PendingConflictError();
        autoRecorded.push(await this.recordMatched(transactions, next, matched));
        continue;
      }
      remaining.push(next);
    }

    return { kind: 'recorded', picked, autoRecorded, next: await this.buildPrompt(tx, remaining) };
  }

  private matcherFor(db: Prisma.TransactionClient): CategoryMatcher {
    return new CategoryMatcher(new CategoryRepository(db), new KeywordRepository(db));
  }

  private async recordMatched(
    transactions: TransactionRepository,
    entry: Omit<BatchEntryInput, 'line'>,
    category: CategorySummary,
  ): Promise<RecordedEntry> {
    const { id } = await transactions.create({
      ledger: entry.ledger,
      entryType: entry.entryType,
      item: entry.item,
      amount: entry.amount,
      categoryId: category.id,
      occurredOn: entry.occurredOn,
      note: entry.note,
      source: 'line_text',
    });
    return {
      transactionId: id,
      ledger: entry.ledger,
      entryType: entry.entryType,
      item: entry.item,
      amount: entry.amount,
      categoryName: category.name,
      occurredOn: entry.occurredOn,
    };
  }

  /** remaining 依 seq 升冪；取第一筆組成分類選項。 */
  private async buildPrompt(
    db: PrismaClient | Prisma.TransactionClient,
    remaining: readonly PendingEntry[],
  ): Promise<PendingPrompt | null> {
    const first = remaining[0];
    if (!first) return null;
    return {
      pendingId: first.id,
      ledger: first.ledger,
      entryType: first.entryType,
      item: first.item,
      amount: first.amount,
      occurredOn: first.occurredOn,
      remaining: remaining.length,
      categories: await new CategoryRepository(db).listByGroup(first.ledger, first.entryType),
    };
  }

  /** 以分類按鈕完成記帳（一次性 token；全程單一交易）。 */
  async completePick(payload: PickPayload): Promise<CompletePickResult> {
    try {
      return await this.deps.prisma.$transaction((tx) =>
        this.completePickInTransaction(tx, payload),
      );
    } catch (error) {
      if (error instanceof PickTokenConflictError) return { kind: 'alreadyUsed' };
      throw error;
    }
  }

  private async completePickInTransaction(
    tx: Prisma.TransactionClient,
    payload: PickPayload,
  ): Promise<CompletePickResult> {
    const tokens = new PostbackTokenRepository(tx);
    if (await tokens.isUsed(payload.token)) return { kind: 'alreadyUsed' };

    const category = await new CategoryRepository(tx).findById(payload.categoryId);
    if (!category) return { kind: 'categoryNotFound' };
    if (category.ledger !== payload.ledger || category.entryType !== payload.entryType) {
      return { kind: 'categoryMismatch' };
    }

    try {
      await tokens.markUsed(payload.token);
    } catch (error) {
      if (isUniqueViolation(error)) throw new PickTokenConflictError();
      throw error;
    }

    const { id: transactionId } = await new TransactionRepository(tx).create({
      ledger: payload.ledger,
      entryType: payload.entryType,
      item: payload.item,
      amount: payload.amount,
      categoryId: category.id,
      occurredOn: payload.date,
      note: payload.note,
      source: 'line_text',
    });
    await tokens.attachTransaction(payload.token, transactionId);

    if (!category.isFallback) {
      await new KeywordRepository(tx).upsert(
        payload.ledger,
        payload.entryType,
        payload.item,
        category.id,
      );
    }

    return {
      kind: 'recorded',
      transactionId,
      categoryName: category.name,
      occurredOn: payload.date,
    };
  }

  /** 依 id 取紀錄摘要（刪除確認 / 取消用）；不存在或 id 不合法回 null。 */
  async findSummaryById(id: number): Promise<TransactionSummary | null> {
    if (!isValidRecordId(id)) return null;
    return this.transactions.findSummaryById(id);
  }

  /** 刪除一筆記帳紀錄；不存在或 id 不合法回 notFound。 */
  async deleteById(id: number): Promise<DeleteByIdResult> {
    if (!isValidRecordId(id)) return { kind: 'notFound' };
    const deleted = await this.transactions.deleteById(id);
    if (!deleted) return { kind: 'notFound' };
    return {
      kind: 'deleted',
      item: deleted.item,
      amount: deleted.amount,
      occurredOn: deleted.occurredOn,
    };
  }

  /**
   * LIFF 表單記帳（source = liff_form）。
   * @throws DomainError NOT_FOUND（分類不存在）、CATEGORY_MISMATCH（分類帳本或收支不符）
   */
  async createFromForm(input: FormTransactionInput): Promise<TransactionDetail> {
    await this.requireMatchingCategory(input.ledger, input.entryType, input.categoryId);
    try {
      return await this.transactions.createDetailed({ ...input, source: 'liff_form' });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', CATEGORY_NOT_FOUND_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * LIFF 批次記帳（source = liff_form）：先檢查全部分類，再於單一交易內依序寫入；任一筆失敗全部不寫入。
   * 錯誤訊息以「第 N 筆：」開頭（N 為 1 起算的索引）。
   * @throws DomainError NOT_FOUND、CATEGORY_MISMATCH
   */
  async createManyFromForm(inputs: readonly FormTransactionInput[]): Promise<TransactionDetail[]> {
    for (const [index, input] of inputs.entries()) {
      try {
        await this.requireMatchingCategory(input.ledger, input.entryType, input.categoryId);
      } catch (error) {
        if (error instanceof DomainError) {
          throw new DomainError(error.violationType, `第 ${index + 1} 筆：${error.message}`);
        }
        throw error;
      }
    }
    try {
      return await this.deps.prisma.$transaction(async (tx) => {
        const repo = new TransactionRepository(tx);
        const created: TransactionDetail[] = [];
        for (const input of inputs) {
          created.push(await repo.createDetailed({ ...input, source: 'liff_form' }));
        }
        return created;
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', CATEGORY_NOT_FOUND_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * LIFF 編輯：全欄位更新，source 不變；任何檢查失敗皆不寫入。
   * @throws DomainError NOT_FOUND（紀錄或分類不存在）、CATEGORY_MISMATCH
   */
  async updateFromForm(id: number, input: FormTransactionInput): Promise<TransactionDetail> {
    if (!(await this.findSummaryById(id))) {
      throw new DomainError('NOT_FOUND', TRANSACTION_NOT_FOUND_MESSAGE);
    }
    await this.requireMatchingCategory(input.ledger, input.entryType, input.categoryId);

    let updated: TransactionDetail | null;
    try {
      updated = await this.transactions.update(id, input);
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', CATEGORY_NOT_FOUND_MESSAGE);
      }
      throw error;
    }
    if (!updated) throw new DomainError('NOT_FOUND', TRANSACTION_NOT_FOUND_MESSAGE);
    return updated;
  }

  /**
   * LIFF 刪除（硬刪除）。
   * @throws DomainError NOT_FOUND（紀錄不存在，含重複刪除）
   */
  async deleteFromForm(id: number): Promise<void> {
    const result = await this.deleteById(id);
    if (result.kind === 'notFound') {
      throw new DomainError('NOT_FOUND', TRANSACTION_NOT_FOUND_MESSAGE);
    }
  }

  /**
   * 指定帳本、月份（'YYYY-MM'）的紀錄，日期新到舊、同日 id 大到小。
   * @throws RangeError month 格式不合法（呼叫端應先以 schema 驗證）
   */
  listByMonth(ledger: Ledger, month: string): Promise<TransactionDetail[]> {
    return this.transactions.listByDateRange(ledger, monthRange(month));
  }

  /**
   * 分類必須存在且屬於指定帳本與收支。
   * @throws DomainError NOT_FOUND、CATEGORY_MISMATCH
   */
  private async requireMatchingCategory(
    ledger: Ledger,
    entryType: EntryType,
    categoryId: number,
  ): Promise<void> {
    const category = isValidRecordId(categoryId)
      ? await this.categories.findById(categoryId)
      : null;
    if (!category) throw new DomainError('NOT_FOUND', CATEGORY_NOT_FOUND_MESSAGE);
    if (category.ledger !== ledger || category.entryType !== entryType) {
      throw new DomainError('CATEGORY_MISMATCH', CATEGORY_MISMATCH_MESSAGE);
    }
  }

  /** ASM-08：分類數為 0 時建立預設分類（ensureDefaultCategories 本身冪等、可併發）。 */
  private async ensureCategoriesExist(): Promise<void> {
    if ((await this.categories.count()) === 0) {
      await this.deps.onboarding.ensureDefaultCategories();
    }
  }
}
