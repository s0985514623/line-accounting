/**
 * 單元測試：TransactionService.findSummaryById / deleteById
 *
 * 執行：npx vitest run tests/unit/services/transaction-service.delete.test.ts
 *
 * 契約（nodejs-master 請遵循）——src/services/transaction-service.ts：
 *   export interface TransactionSummary { id: number; item: string; amount: number; occurredOn: string（YYYY-MM-DD） }
 *   class TransactionService {
 *     findSummaryById(id: number): Promise<TransactionSummary | null>;          // 不存在 → null
 *     deleteById(id: number): Promise<DeleteByIdResult>;
 *   }
 *   type DeleteByIdResult =
 *     | { kind: 'deleted'; item: string; amount: number; occurredOn: string }   // occurredOn 為 YYYY-MM-DD
 *     | { kind: 'notFound' };
 *
 *   - id 不是安全的正整數（NaN、Infinity、0、負數、小數、非 number 型別）或超過 PostgreSQL int4 上限 2147483647
 *     → 視為不存在：直接回 null / { kind: 'notFound' }，完全不呼叫 prisma（避免 Prisma 驗證錯誤變成「系統忙碌」）。
 *   - deleteById 只呼叫一次 prisma.transaction.delete({ where: { id } })，以其回傳列組成 deleted 結果
 *     （回傳列含 item / amount / occurredOn（UTC 午夜 Date））；不先 select 再 delete（避免 TOCTOU）。
 *   - prisma.transaction.delete 拋 Prisma.PrismaClientKnownRequestError code 'P2025'（紀錄不存在，例如重複點「確定」）
 *     → { kind: 'notFound' }；其他例外（連線錯誤、P2003 等）原樣往外拋，由 event-dispatcher 回「系統忙碌」。
 *   - findSummaryById 使用 prisma.transaction.findUnique|findFirst({ where: { id } })。
 * 依據：specs/features/transaction/確認刪除記帳紀錄.feature；implementation-plan P4（id 非數字視為不存在、P2025 → 此紀錄已不存在）。
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { TransactionService } from '../../../src/services/transaction-service';

type DeleteByIdResult =
  { kind: 'deleted'; item: string; amount: number; occurredOn: string } | { kind: 'notFound' };

interface DeleteService {
  findSummaryById(
    id: number,
  ): Promise<{ id: number; item: string; amount: number; occurredOn: string } | null>;
  deleteById(id: number): Promise<DeleteByIdResult>;
}

const ROW = {
  id: 10,
  item: '午餐',
  amount: 120,
  occurredOn: new Date('2026-11-12T00:00:00.000Z'),
};

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`mock ${code}`, {
    code,
    clientVersion: 'test',
  });
}

function setup(
  options: {
    deleteImpl?: (args: { where: { id: number } }) => Promise<unknown>;
    findImpl?: (args: { where: { id: number } }) => Promise<unknown>;
  } = {},
) {
  const del = vi.fn(options.deleteImpl ?? (async () => ROW));
  const find = vi.fn(options.findImpl ?? (async () => ROW));
  const otherEntry = vi.fn();
  const prisma = {
    transaction: { delete: del, findUnique: find, findFirst: find },
    // 若實作誤用其他入口（$transaction / raw SQL），這些 spy 會被記錄
    $transaction: otherEntry,
    $queryRaw: otherEntry,
    $executeRaw: otherEntry,
  };
  const service = new TransactionService({
    prisma: prisma as unknown as PrismaClient,
    clock: { now: () => new Date('2026-11-15T00:00:00.000Z') },
    onboarding: { ensureDefaultCategories: vi.fn() },
  }) as unknown as DeleteService;
  return { service, del, find, otherEntry };
}

describe('TransactionService.deleteById', () => {
  describe('Happy', () => {
    it('刪除成功 → deleted，帶回項目 / 金額 / YYYY-MM-DD 日期', async () => {
      const { service, del } = setup();
      await expect(service.deleteById(10)).resolves.toEqual({
        kind: 'deleted',
        item: '午餐',
        amount: 120,
        occurredOn: '2026-11-12',
      });
      expect(del).toHaveBeenCalledTimes(1);
      expect(del).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 10 } }));
    });

    it('日期以 UTC 欄位格式化（不受 TZ 影響）：2026-01-01 不會變成 2025-12-31', async () => {
      const { service } = setup({
        deleteImpl: async () => ({ ...ROW, occurredOn: new Date('2026-01-01T00:00:00.000Z') }),
      });
      const result = await service.deleteById(10);
      expect(result).toMatchObject({ kind: 'deleted', occurredOn: '2026-01-01' });
    });

    it('int4 上限 2147483647 仍視為合法 id 並送到資料庫', async () => {
      const { service, del } = setup();
      await service.deleteById(2_147_483_647);
      expect(del).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2_147_483_647 } }));
    });
  });

  describe('Error：紀錄不存在', () => {
    it('P2025 → notFound（重複點「確定」的情境）', async () => {
      const { service } = setup({
        deleteImpl: async () => {
          throw prismaError('P2025');
        },
      });
      await expect(service.deleteById(99)).resolves.toEqual({ kind: 'notFound' });
    });

    it('同一 id 連刪兩次：第一次 deleted、第二次 notFound', async () => {
      let first = true;
      const { service } = setup({
        deleteImpl: async () => {
          if (first) {
            first = false;
            return ROW;
          }
          throw prismaError('P2025');
        },
      });
      await expect(service.deleteById(10)).resolves.toMatchObject({ kind: 'deleted' });
      await expect(service.deleteById(10)).resolves.toEqual({ kind: 'notFound' });
    });
  });

  describe('Edge：id 非合法正整數 → 視為不存在，且不碰資料庫', () => {
    it.each([
      ['NaN（Number("abc")）', Number('abc')],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['0', 0],
      ['-0', -0],
      ['負數', -1],
      ['小數', 1.5],
      ['超過 int4 上限', 2_147_483_648],
      ['超過安全整數', Number.MAX_SAFE_INTEGER + 2],
      ['1e21', 1e21],
    ])('%s', async (_name, id) => {
      const { service, del, find, otherEntry } = setup();
      await expect(service.deleteById(id)).resolves.toEqual({ kind: 'notFound' });
      expect(del).not.toHaveBeenCalled();
      expect(find).not.toHaveBeenCalled();
      expect(otherEntry).not.toHaveBeenCalled();
    });

    it('非 number 型別（字串 / null / undefined / 物件）也視為不存在，不拋出', async () => {
      const { service, del } = setup();
      for (const bad of ['10', 'abc', '', null, undefined, {}, []]) {
        await expect(service.deleteById(bad as unknown as number)).resolves.toEqual({
          kind: 'notFound',
        });
      }
      expect(del).not.toHaveBeenCalled();
    });
  });

  describe('Error：非預期例外原樣往外拋', () => {
    it('連線錯誤（一般 Error）', async () => {
      const boom = new Error('connection refused');
      const { service } = setup({
        deleteImpl: async () => {
          throw boom;
        },
      });
      await expect(service.deleteById(10)).rejects.toBe(boom);
    });

    it('其他 Prisma 錯誤碼（P2003 外鍵、P2024 逾時、P1001）不被誤判成 notFound', async () => {
      for (const code of ['P2003', 'P2024', 'P1001']) {
        const error = prismaError(code);
        const { service } = setup({
          deleteImpl: async () => {
            throw error;
          },
        });
        await expect(service.deleteById(10)).rejects.toBe(error);
      }
    });
  });
});

describe('TransactionService.findSummaryById', () => {
  it('存在 → 回傳 id / 項目 / 金額 / YYYY-MM-DD 日期', async () => {
    const { service, find } = setup();
    await expect(service.findSummaryById(10)).resolves.toEqual({
      id: 10,
      item: '午餐',
      amount: 120,
      occurredOn: '2026-11-12',
    });
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 10 } }));
  });

  it('不存在（查無列）→ null', async () => {
    const { service } = setup({ findImpl: async () => null });
    await expect(service.findSummaryById(99)).resolves.toBeNull();
  });

  it.each([
    ['NaN', Number('abc')],
    ['0', 0],
    ['負數', -5],
    ['小數', 2.5],
    ['超過 int4 上限', 2_147_483_648],
  ])('id 非合法正整數（%s）→ null，且不查資料庫', async (_name, id) => {
    const { service, find } = setup();
    await expect(service.findSummaryById(id)).resolves.toBeNull();
    expect(find).not.toHaveBeenCalled();
  });

  it('資料庫例外原樣往外拋', async () => {
    const boom = new Error('db down');
    const { service } = setup({
      findImpl: async () => {
        throw boom;
      },
    });
    await expect(service.findSummaryById(10)).rejects.toBe(boom);
  });

  it('只讀不寫：不呼叫 delete', async () => {
    const { service, del } = setup();
    await service.findSummaryById(10);
    expect(del).not.toHaveBeenCalled();
  });
});
