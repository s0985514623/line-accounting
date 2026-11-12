/**
 * 單元測試：選擇分類完成記帳（completePick）與 postback-handler 的 pick 分支
 *
 * 執行：npx vitest run tests/unit/services/transaction-service.pick.test.ts
 *
 * 契約（nodejs-master 請遵循）：
 *
 * 一、src/services/transaction-service.ts
 *   class TransactionService {
 *     completePick(payload: PickPayload): Promise<CompletePickResult>;   // PickPayload 來自 src/domain/postback-codec.ts
 *   }
 *   type CompletePickResult =
 *     | { kind: 'recorded'; transactionId: number; categoryName: string; occurredOn: string（YYYY-MM-DD） }
 *     | { kind: 'alreadyUsed' }        // token 已使用（查重命中，或併發時 insert token 撞 PK → Prisma P2002）
 *     | { kind: 'categoryNotFound' }   // categoryId 不存在
 *     | { kind: 'categoryMismatch' };  // 分類存在但帳本或收支與 payload 不符
 *   - 整段只用一個 deps.prisma.$transaction(async (tx) => …)（callback 形式）；交易外不得碰任何資料表。
 *   - 交易內順序固定：token 查重 → 分類驗證 → insert token → insert transaction → 回填 token.transactionId
 *     → 非 fallback 分類才 upsert keyword。token 已使用時優先回 alreadyUsed（即使分類也有誤）。
 *   - 分類錯誤（NotFound / Mismatch）與 alreadyUsed 皆「不消耗 token、不寫入任何資料」。
 *   - insert token 拋 Prisma.PrismaClientKnownRequestError(code 'P2002') → 回 alreadyUsed（交易整段 rollback）；
 *     其他例外原樣往外拋（由 event-dispatcher 回「系統忙碌」）。
 *   - 使用的 Prisma 方法（本測試的記憶體替身只實作這些）：
 *       tx.postbackToken.findUnique|findFirst|count({ where: { token } })、.create({ data: { token } })、
 *       .update({ where: { token }, data: { transactionId } })
 *       tx.category.findUnique|findFirst({ where: { id } })      // 回傳含 id/ledger/entryType/name/isFallback
 *       tx.transaction.create({ data })                          // data.source = 'line_text'，occurredOn 為 UTC 午夜 Date 或 YYYY-MM-DD 字串
 *       tx.categoryKeyword.upsert({
 *         where: { ledger_entryType_keyword: { ledger, entryType, keyword } },
 *         create: { ledger, entryType, keyword, categoryId },
 *         update: { categoryId },
 *       })
 *   - 記帳日期取 payload.date（按鈕上的日期），不另取 clock。
 *
 * 二、src/line/handlers/postback-handler.ts
 *   class PostbackHandler {
 *     constructor(transactions: Pick<TransactionService, 'completePick'>, logger: Logger);
 *     handle(postback: { data: string }, replier: Replier): Promise<void>;
 *   }
 *   - pick 的 data 以 decodePostback 解碼；解碼失敗（竄改、缺欄位、欄位不合法）→ 只回一則文字
 *     「資料格式錯誤，請重新記帳」（ASM-07），不呼叫 completePick。
 *   - 結果對應：recorded → buildRecordedReply(...)；alreadyUsed → 「此筆已記帳」；
 *     categoryNotFound → 「分類不存在，請重新記帳」；categoryMismatch → 「分類不符，請重新記帳」。
 *   - completePick 的非預期例外不在 handler 內吞掉（往外拋給 dispatcher）。
 *   （unknown action / data 空 的處理規格未定，本檔不測。）
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { PickPayload } from '../../../src/domain/postback-codec';
import { encodePick } from '../../../src/domain/postback-codec';
import { buildRecordedReply } from '../../../src/line/messages/entry-replies';
import { TransactionService } from '../../../src/services/transaction-service';

// ---- 契約型別（Green 後與 src 對齊；此處自行宣告以免 Red 階段型別檢查被缺漏的 src 擋住）-----------

type CompletePickResult =
  | { kind: 'recorded'; transactionId: number; categoryName: string; occurredOn: string }
  | { kind: 'alreadyUsed' }
  | { kind: 'categoryNotFound' }
  | { kind: 'categoryMismatch' };

interface PickService {
  completePick(payload: PickPayload): Promise<CompletePickResult>;
}

// ---- 記憶體版 Prisma 替身 ---------------------------------------------------------------------

interface CategoryRow {
  id: number;
  ledger: 'personal' | 'company';
  entryType: 'expense' | 'income';
  name: string;
  isFallback: boolean;
}

interface Store {
  categories: CategoryRow[];
  tokens: Array<{ token: string; transactionId: number | null }>;
  transactions: Array<Record<string, unknown> & { id: number }>;
  keywords: Array<{
    ledger: string;
    entryType: string;
    keyword: string;
    categoryId: number;
  }>;
}

const CATEGORIES: CategoryRow[] = [
  { id: 1, ledger: 'personal', entryType: 'expense', name: '餐飲', isFallback: false },
  { id: 2, ledger: 'personal', entryType: 'expense', name: '其他', isFallback: true },
  { id: 5, ledger: 'company', entryType: 'expense', name: '文具', isFallback: false },
  { id: 7, ledger: 'personal', entryType: 'income', name: '薪資', isFallback: false },
];

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`token`)',
    {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['token'] },
    },
  );
}

/**
 * 交易語意：$transaction(cb) 在 store 的副本上執行；cb 拋出則整份副本丟棄（rollback），否則提交。
 * calls 記錄「寫入 / 讀取」呼叫順序（不受 rollback 影響），用來驗證順序與「根本沒寫」。
 */
function createFakePrisma(
  options: {
    seedTokens?: string[];
    failOn?: Partial<Record<string, Error>>;
  } = {},
) {
  const store: Store = {
    categories: CATEGORIES.map((row) => ({ ...row })),
    tokens: (options.seedTokens ?? []).map((token) => ({ token, transactionId: null })),
    transactions: [],
    keywords: [],
  };
  const calls: string[] = [];
  const upsertArgs: Array<Record<string, unknown>> = [];
  const txCreateArgs: Array<Record<string, unknown>> = [];
  let nextTransactionId = 100;
  let transactionCalls = 0;

  const record = (name: string): void => {
    calls.push(name);
    const failure = options.failOn?.[name];
    if (failure) throw failure;
  };

  const makeTx = (draft: Store) => {
    const findToken = (args: { where: { token: string } }) =>
      draft.tokens.find((row) => row.token === args.where.token) ?? null;
    const findCategory = (args: { where: { id: number } }) =>
      draft.categories.find((row) => row.id === args.where.id) ?? null;
    return {
      postbackToken: {
        findUnique: async (args: { where: { token: string } }) => {
          record('postbackToken.read');
          return findToken(args);
        },
        findFirst: async (args: { where: { token: string } }) => {
          record('postbackToken.read');
          return findToken(args);
        },
        count: async (args: { where: { token: string } }) => {
          record('postbackToken.read');
          return findToken(args) ? 1 : 0;
        },
        create: async (args: { data: { token: string; transactionId?: number | null } }) => {
          record('postbackToken.create');
          if (draft.tokens.some((row) => row.token === args.data.token)) throw p2002();
          const row = { token: args.data.token, transactionId: args.data.transactionId ?? null };
          draft.tokens.push(row);
          return { ...row };
        },
        update: async (args: {
          where: { token: string };
          data: { transactionId: number | null };
        }) => {
          record('postbackToken.update');
          const row = findToken(args);
          if (!row) throw new Error('postbackToken.update: 找不到 token');
          row.transactionId = args.data.transactionId;
          return { ...row };
        },
      },
      category: {
        findUnique: async (args: { where: { id: number } }) => {
          record('category.read');
          return findCategory(args);
        },
        findFirst: async (args: { where: { id: number } }) => {
          record('category.read');
          return findCategory(args);
        },
      },
      transaction: {
        create: async (args: { data: Record<string, unknown> }) => {
          record('transaction.create');
          txCreateArgs.push(args.data);
          const row = { ...args.data, id: nextTransactionId++ };
          draft.transactions.push(row);
          return row;
        },
      },
      categoryKeyword: {
        upsert: async (args: {
          where: {
            ledger_entryType_keyword: { ledger: string; entryType: string; keyword: string };
          };
          create: { ledger: string; entryType: string; keyword: string; categoryId: number };
          update: { categoryId: number };
        }) => {
          record('categoryKeyword.upsert');
          upsertArgs.push(args as unknown as Record<string, unknown>);
          const key = args.where.ledger_entryType_keyword;
          const existing = draft.keywords.find(
            (row) =>
              row.ledger === key.ledger &&
              row.entryType === key.entryType &&
              row.keyword === key.keyword,
          );
          if (existing) existing.categoryId = args.update.categoryId;
          else draft.keywords.push({ ...args.create });
          return existing ?? args.create;
        },
      },
    };
  };

  const outsideTransaction = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, method) => () => {
          throw new Error(
            `交易外不得存取 ${name}.${String(method)}（completePick 必須全程在單一 $transaction 內）`,
          );
        },
      },
    );

  const prisma = {
    $transaction: async <T>(
      callback: (tx: ReturnType<typeof makeTx>) => Promise<T>,
    ): Promise<T> => {
      if (typeof callback !== 'function') {
        throw new Error('completePick 必須使用 callback 形式的 $transaction');
      }
      transactionCalls += 1;
      const draft = structuredClone(store);
      const result = await callback(makeTx(draft));
      Object.assign(store, draft); // 只有 callback 成功才提交
      return result;
    },
    postbackToken: outsideTransaction('postbackToken'),
    category: outsideTransaction('category'),
    transaction: outsideTransaction('transaction'),
    categoryKeyword: outsideTransaction('categoryKeyword'),
  };

  return {
    prisma,
    store,
    calls,
    upsertArgs,
    txCreateArgs,
    get transactionCalls() {
      return transactionCalls;
    },
  };
}

function createService(fake: ReturnType<typeof createFakePrisma>): PickService {
  const service = new TransactionService({
    prisma: fake.prisma as unknown as PrismaClient,
    clock: { now: () => new Date('2026-11-15T00:00:00.000Z') }, // 與 payload.date 刻意不同日
    onboarding: { ensureDefaultCategories: vi.fn() },
  });
  return service as unknown as PickService;
}

const basePayload: PickPayload = {
  token: 'tk1',
  ledger: 'personal',
  entryType: 'expense',
  item: '早餐',
  amount: 80,
  date: '2026-11-12',
  note: '便利商店',
  categoryId: 1,
};

function dateOnly(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

/** 沒有任何東西被提交到 store。 */
function expectNothingCommitted(fake: ReturnType<typeof createFakePrisma>, seeded: string[] = []) {
  expect(fake.store.transactions).toEqual([]);
  expect(fake.store.keywords).toEqual([]);
  expect(fake.store.tokens.map((row) => row.token)).toEqual(seeded);
}

// ---- completePick -----------------------------------------------------------------------------

describe('TransactionService.completePick', () => {
  describe('Happy：選擇一般分類', () => {
    it('建立記帳、記下 token 並回填 transactionId、學習關鍵字', async () => {
      const fake = createFakePrisma();
      const result = await createService(fake).completePick(basePayload);

      expect(result).toEqual({
        kind: 'recorded',
        transactionId: 100,
        categoryName: '餐飲',
        occurredOn: '2026-11-12',
      });
      expect(fake.store.transactions).toHaveLength(1);
      expect(fake.store.transactions[0]).toMatchObject({
        ledger: 'personal',
        entryType: 'expense',
        item: '早餐',
        amount: 80,
        categoryId: 1,
        note: '便利商店',
        source: 'line_text',
      });
      expect(dateOnly(fake.store.transactions[0]?.occurredOn)).toBe('2026-11-12');
      expect(fake.store.tokens).toEqual([{ token: 'tk1', transactionId: 100 }]);
      expect(fake.store.keywords).toEqual([
        { ledger: 'personal', entryType: 'expense', keyword: '早餐', categoryId: 1 },
      ]);
    });

    it('整段只開一個 $transaction，且順序為 token 查重 → 分類驗證 → insert token → insert tx → 回填 → 學習', async () => {
      const fake = createFakePrisma();
      await createService(fake).completePick(basePayload);

      expect(fake.transactionCalls).toBe(1);
      expect(fake.calls).toEqual([
        'postbackToken.read',
        'category.read',
        'postbackToken.create',
        'transaction.create',
        'postbackToken.update',
        'categoryKeyword.upsert',
      ]);
    });

    it('備註為 null 時 transaction.note 為 null', async () => {
      const fake = createFakePrisma();
      await createService(fake).completePick({ ...basePayload, note: null });

      expect(fake.txCreateArgs[0]).toMatchObject({ note: null });
    });

    it('關鍵字 upsert 的 create / update 都指向所選分類（已存在的關鍵字改指向）', async () => {
      const fake = createFakePrisma();
      fake.store.keywords.push({
        ledger: 'personal',
        entryType: 'expense',
        keyword: '早餐',
        categoryId: 2,
      });
      await createService(fake).completePick(basePayload);

      expect(fake.upsertArgs[0]).toMatchObject({
        where: {
          ledger_entryType_keyword: { ledger: 'personal', entryType: 'expense', keyword: '早餐' },
        },
        create: { ledger: 'personal', entryType: 'expense', keyword: '早餐', categoryId: 1 },
        update: { categoryId: 1 },
      });
      expect(fake.store.keywords).toEqual([
        { ledger: 'personal', entryType: 'expense', keyword: '早餐', categoryId: 1 },
      ]);
    });

    it('收入分類亦可完成（帳本 / 收支與分類一致）', async () => {
      const fake = createFakePrisma();
      const result = await createService(fake).completePick({
        ...basePayload,
        entryType: 'income',
        item: '年終',
        categoryId: 7,
      });

      expect(result).toMatchObject({ kind: 'recorded', categoryName: '薪資' });
    });
  });

  describe('Happy：選擇「其他」(fallback) 分類', () => {
    it('記帳但不學習關鍵字（不呼叫 upsert）', async () => {
      const fake = createFakePrisma();
      const result = await createService(fake).completePick({
        ...basePayload,
        item: '雜支',
        amount: 50,
        note: null,
        categoryId: 2,
      });

      expect(result).toMatchObject({ kind: 'recorded', categoryName: '其他' });
      expect(fake.store.transactions).toHaveLength(1);
      expect(fake.store.keywords).toEqual([]);
      expect(fake.calls).not.toContain('categoryKeyword.upsert');
    });
  });

  describe('Error：token 已使用', () => {
    it('查重命中 → alreadyUsed，不寫入任何資料、不查分類', async () => {
      const fake = createFakePrisma({ seedTokens: ['tk1'] });
      const result = await createService(fake).completePick(basePayload);

      expect(result).toEqual({ kind: 'alreadyUsed' });
      expectNothingCommitted(fake, ['tk1']);
      expect(fake.calls.filter((name) => name.endsWith('.create'))).toEqual([]);
    });

    it('token 已使用且分類也有誤 → 仍以 alreadyUsed 優先（token 查重在分類驗證之前）', async () => {
      const fake = createFakePrisma({ seedTokens: ['tk1'] });
      const result = await createService(fake).completePick({ ...basePayload, categoryId: 99 });

      expect(result).toEqual({ kind: 'alreadyUsed' });
      expectNothingCommitted(fake, ['tk1']);
    });

    it('併發：insert token 撞 PK（Prisma P2002）→ alreadyUsed，交易 rollback、不拋例外', async () => {
      const fake = createFakePrisma({ failOn: { 'postbackToken.create': p2002() } });
      const result = await createService(fake).completePick(basePayload);

      expect(result).toEqual({ kind: 'alreadyUsed' });
      expectNothingCommitted(fake);
      expect(fake.calls).not.toContain('transaction.create');
      expect(fake.calls).not.toContain('categoryKeyword.upsert');
    });

    it('非 P2002 的資料庫錯誤不被吞掉，原樣往外拋且 rollback', async () => {
      const boom = new Error('connection reset');
      const fake = createFakePrisma({ failOn: { 'transaction.create': boom } });

      await expect(createService(fake).completePick(basePayload)).rejects.toBe(boom);
      expectNothingCommitted(fake);
    });

    it('其他 Prisma 錯誤碼（P2003）同樣原樣往外拋', async () => {
      const fk = new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
        code: 'P2003',
        clientVersion: 'test',
      });
      const fake = createFakePrisma({ failOn: { 'postbackToken.create': fk } });

      await expect(createService(fake).completePick(basePayload)).rejects.toBe(fk);
      expectNothingCommitted(fake);
    });
  });

  describe('Error：分類錯誤時 token 不寫入', () => {
    it('分類不存在 → categoryNotFound；沒有 insert token / transaction / keyword', async () => {
      const fake = createFakePrisma();
      const result = await createService(fake).completePick({ ...basePayload, categoryId: 99 });

      expect(result).toEqual({ kind: 'categoryNotFound' });
      expectNothingCommitted(fake);
      expect(fake.calls).toEqual(['postbackToken.read', 'category.read']);
    });

    it('帳本不符（payload 個人、分類 5 為公司）→ categoryMismatch；token 未被消耗', async () => {
      const fake = createFakePrisma();
      const result = await createService(fake).completePick({ ...basePayload, categoryId: 5 });

      expect(result).toEqual({ kind: 'categoryMismatch' });
      expectNothingCommitted(fake);
      expect(fake.calls).toEqual(['postbackToken.read', 'category.read']);
    });

    it('收支不符（payload 支出、分類 7 為收入）→ categoryMismatch', async () => {
      const fake = createFakePrisma();
      const result = await createService(fake).completePick({ ...basePayload, categoryId: 7 });

      expect(result).toEqual({ kind: 'categoryMismatch' });
      expectNothingCommitted(fake);
    });

    it('分類錯誤後同一 token 改選正確分類仍可記帳（token 未被消耗）', async () => {
      const fake = createFakePrisma();
      const service = createService(fake);

      expect(await service.completePick({ ...basePayload, categoryId: 5 })).toEqual({
        kind: 'categoryMismatch',
      });
      const retry = await service.completePick(basePayload);

      expect(retry).toMatchObject({ kind: 'recorded' });
      expect(fake.store.tokens.map((row) => row.token)).toEqual(['tk1']);
    });
  });

  describe('Edge：重複點擊', () => {
    it('同一 token 連點兩次：第一次記帳，第二次 alreadyUsed，只留一筆記帳', async () => {
      const fake = createFakePrisma();
      const service = createService(fake);

      const first = await service.completePick(basePayload);
      const second = await service.completePick(basePayload);

      expect(first).toMatchObject({ kind: 'recorded' });
      expect(second).toEqual({ kind: 'alreadyUsed' });
      expect(fake.store.transactions).toHaveLength(1);
      expect(fake.store.tokens).toHaveLength(1);
    });
  });
});

// ---- postback-handler 的 pick 分支 -------------------------------------------------------------

interface PostbackHandlerLike {
  handle(
    postback: { data: string },
    replier: { reply(messages: unknown[]): Promise<void> },
  ): Promise<void>;
}

async function createHandler(completePick: (payload: PickPayload) => Promise<CompletePickResult>) {
  const mod = await import('../../../src/line/handlers/postback-handler.js');
  const Handler = mod.PostbackHandler as unknown as new (
    transactions: { completePick: typeof completePick },
    logger: pino.Logger,
  ) => PostbackHandlerLike;
  return new Handler({ completePick }, pino({ level: 'silent' }));
}

function createReplier() {
  return { reply: vi.fn(async (_messages: unknown[]) => undefined) };
}

const VALID_DATA = encodePick(basePayload);

describe('PostbackHandler pick 分支', () => {
  describe('Security / Error：data 竄改 → ASM-07「資料格式錯誤，請重新記帳」', () => {
    const tampered: Array<[string, string]> = [
      ['缺 categoryId 欄位', VALID_DATA.replace(/&categoryId=\d+$/, '')],
      ['缺 token 欄位', VALID_DATA.replace('token=tk1&', '')],
      ['金額非數字', VALID_DATA.replace('amount=80', 'amount=abc')],
      ['金額為 0', VALID_DATA.replace('amount=80', 'amount=0')],
      ['金額為小數', VALID_DATA.replace('amount=80', 'amount=12.5')],
      ['日期不存在', VALID_DATA.replace('date=2026-11-12', 'date=2026-02-30')],
      ['帳本值不合法', VALID_DATA.replace('ledger=personal', 'ledger=hacker')],
      ['收支值不合法', VALID_DATA.replace('type=expense', 'type=transfer')],
      ['categoryId 非正整數', VALID_DATA.replace(/categoryId=\d+$/, 'categoryId=-1')],
      [
        'categoryId 為 SQL 片段',
        VALID_DATA.replace(/categoryId=\d+$/, 'categoryId=1;DROP TABLE x'),
      ],
      ['多餘欄位', `${VALID_DATA}&admin=1`],
      ['重複欄位', `${VALID_DATA}&categoryId=2`],
    ];

    it.each(tampered)('%s', async (_name, data) => {
      expect(data).not.toBe(VALID_DATA);
      const completePick = vi.fn();
      const replier = createReplier();
      const handler = await createHandler(completePick);

      await handler.handle({ data }, replier);

      expect(completePick).not.toHaveBeenCalled();
      expect(replier.reply).toHaveBeenCalledTimes(1);
      expect(replier.reply).toHaveBeenCalledWith([
        { type: 'text', text: '資料格式錯誤，請重新記帳' },
      ]);
    });
  });

  describe('結果對應', () => {
    it('recorded → 已記帳摘要 + 刪除按鈕，並以解碼後的 payload 呼叫 completePick', async () => {
      const completePick = vi.fn(async () => ({
        kind: 'recorded' as const,
        transactionId: 42,
        categoryName: '餐飲',
        occurredOn: '2026-11-12',
      }));
      const replier = createReplier();
      const handler = await createHandler(completePick);

      await handler.handle({ data: VALID_DATA }, replier);

      expect(completePick).toHaveBeenCalledTimes(1);
      expect(completePick).toHaveBeenCalledWith(expect.objectContaining(basePayload));
      expect(replier.reply).toHaveBeenCalledTimes(1);
      expect(replier.reply).toHaveBeenCalledWith([
        buildRecordedReply({
          ledger: 'personal',
          entryType: 'expense',
          item: '早餐',
          amount: 80,
          categoryName: '餐飲',
          occurredOn: '2026-11-12',
          transactionId: 42,
        }),
      ]);
    });

    it.each([
      ['alreadyUsed', '此筆已記帳'],
      ['categoryNotFound', '分類不存在，請重新記帳'],
      ['categoryMismatch', '分類不符，請重新記帳'],
    ] as const)('%s → 回覆「%s」', async (kind, text) => {
      const completePick = vi.fn(async () => ({ kind }));
      const replier = createReplier();
      const handler = await createHandler(completePick);

      await handler.handle({ data: VALID_DATA }, replier);

      expect(replier.reply).toHaveBeenCalledTimes(1);
      expect(replier.reply).toHaveBeenCalledWith([{ type: 'text', text }]);
    });

    it('completePick 拋出非預期例外時不吞掉（交給 dispatcher 回「系統忙碌」）', async () => {
      const boom = new Error('db down');
      const completePick = vi.fn(async () => {
        throw boom;
      });
      const replier = createReplier();
      const handler = await createHandler(completePick);

      await expect(handler.handle({ data: VALID_DATA }, replier)).rejects.toBe(boom);
      expect(replier.reply).not.toHaveBeenCalled();
    });
  });
});
