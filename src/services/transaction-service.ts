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

export type TextEntryInput = Omit<TextEntry, 'kind'>;

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
    const today = todayInTaipei(this.deps.clock.now());
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
