/**
 * 記帳業務邏輯。
 *
 * createFromText（implementation-plan P3-5、DF-1）：
 *  1. 系統中沒有任何分類時先建立預設分類（ASM-08）。
 *  2. 同帳本同收支比對分類：名稱 → 關鍵字。
 *  3. 命中 → 寫入一筆 LINE 文字記帳（日期為 Asia/Taipei 的今天）；不學關鍵字、不寫 postback token。
 *  4. 未命中 → 不寫入任何資料，回傳該組分類（依 id 升冪）與新的一次性 token，供回覆分類按鈕（無狀態草稿）。
 * completePick（pick 完成記帳）屬 P3b。
 */
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { todayInTaipei } from '../domain/date-utils';
import type { TextEntry } from '../domain/text-entry-parser';
import type { Clock } from '../ports/clock';
import { CategoryRepository, type CategorySummary } from '../repositories/category-repository';
import { KeywordRepository } from '../repositories/keyword-repository';
import { TransactionRepository } from '../repositories/transaction-repository';
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

  /** ASM-08：分類數為 0 時建立預設分類（ensureDefaultCategories 本身冪等、可併發）。 */
  private async ensureCategoriesExist(): Promise<void> {
    if ((await this.categories.count()) === 0) {
      await this.deps.onboarding.ensureDefaultCategories();
    }
  }
}
