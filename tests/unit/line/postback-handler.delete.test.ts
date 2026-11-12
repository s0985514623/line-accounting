/**
 * 單元測試：postback-handler 的 delete / delete_confirm / delete_cancel 分支
 *
 * 執行：npx vitest run tests/unit/line/postback-handler.delete.test.ts
 *
 * 契約（nodejs-master 請遵循）——src/line/handlers/postback-handler.ts：
 *   constructor(
 *     transactions: Pick<TransactionService, 'completePick' | 'findSummaryById' | 'deleteById'>,
 *     logger: Logger,
 *   )
 *   - delete：findSummaryById(id)；存在 → 回 buildDeleteConfirmReply（只回一則，且不呼叫 deleteById）；
 *            不存在（null）→ 文字「此紀錄已不存在」。
 *   - delete_confirm：deleteById(id)；deleted → buildDeletedReply；notFound → 「此紀錄已不存在」。
 *   - delete_cancel：findSummaryById(id)；存在 → 「已取消刪除」；不存在 → 「此紀錄已不存在」（implementation-plan P4）；
 *            取消絕不呼叫 deleteById。
 *   - data 解碼失敗（含 id 非數字）→ 「資料格式錯誤，請重新記帳」，不呼叫任何 service 方法。
 *   - service 的非預期例外往外拋（交 dispatcher 回「系統忙碌」），handler 不吞、不先回覆。
 *   - 每次 handle 恰好呼叫 replier.reply 一次（reply token 一次性）。
 */
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { PostbackHandler } from '../../../src/line/handlers/postback-handler';
import type { LineMessage } from '../../../src/ports/line-reply-gateway';

const SUMMARY = { id: 10, item: '午餐', amount: 120, occurredOn: '2026-11-12' };

function setup(
  overrides: {
    findSummaryById?: () => Promise<unknown>;
    deleteById?: () => Promise<unknown>;
  } = {},
) {
  const findSummaryById = vi.fn(overrides.findSummaryById ?? (async () => SUMMARY));
  const deleteById = vi.fn(
    overrides.deleteById ??
      (async () => ({ kind: 'deleted', item: '午餐', amount: 120, occurredOn: '2026-11-12' })),
  );
  const completePick = vi.fn();
  const handler = new PostbackHandler(
    { completePick, findSummaryById, deleteById } as never,
    pino({ level: 'silent' }),
  );
  const replies: LineMessage[][] = [];
  const replier = {
    reply: vi.fn(async (messages: LineMessage[]) => {
      replies.push(messages);
    }),
  };
  return { handler, replier, replies, findSummaryById, deleteById, completePick };
}

describe('[Smoke] delete：回覆確認提示，不改資料', () => {
  it('紀錄存在 → confirm template + 確定 / 取消按鈕；不呼叫 deleteById', async () => {
    const ctx = setup();
    await ctx.handler.handle({ data: 'action=delete&id=10' }, ctx.replier);

    expect(ctx.findSummaryById).toHaveBeenCalledWith(10);
    expect(ctx.deleteById).not.toHaveBeenCalled();
    expect(ctx.replier.reply).toHaveBeenCalledTimes(1);
    expect(ctx.replies[0]).toEqual([
      {
        type: 'template',
        altText: '確定刪除？午餐 120 元（2026-11-12）',
        template: {
          type: 'confirm',
          text: '確定刪除？午餐 120 元（2026-11-12）',
          actions: [
            { type: 'postback', label: '確定', data: 'action=delete_confirm&id=10' },
            { type: 'postback', label: '取消', data: 'action=delete_cancel&id=10' },
          ],
        },
      },
    ]);
  });

  it('紀錄不存在 → 此紀錄已不存在', async () => {
    const ctx = setup({ findSummaryById: async () => null });
    await ctx.handler.handle({ data: 'action=delete&id=99' }, ctx.replier);
    expect(ctx.replies).toEqual([[{ type: 'text', text: '此紀錄已不存在' }]]);
    expect(ctx.deleteById).not.toHaveBeenCalled();
  });
});

describe('[Happy/Error] delete_confirm', () => {
  it('刪除成功 → 已刪除：…', async () => {
    const ctx = setup();
    await ctx.handler.handle({ data: 'action=delete_confirm&id=10' }, ctx.replier);
    expect(ctx.deleteById).toHaveBeenCalledWith(10);
    expect(ctx.replies).toEqual([[{ type: 'text', text: '已刪除：午餐 120 元（2026-11-12）' }]]);
  });

  it('P2025（service 回 notFound）→ 此紀錄已不存在', async () => {
    const ctx = setup({ deleteById: async () => ({ kind: 'notFound' }) });
    await ctx.handler.handle({ data: 'action=delete_confirm&id=10' }, ctx.replier);
    expect(ctx.replies).toEqual([[{ type: 'text', text: '此紀錄已不存在' }]]);
  });

  it('service 非預期例外 → 往外拋，且尚未回覆', async () => {
    const boom = new Error('db down');
    const ctx = setup({
      deleteById: async () => {
        throw boom;
      },
    });
    await expect(
      ctx.handler.handle({ data: 'action=delete_confirm&id=10' }, ctx.replier),
    ).rejects.toBe(boom);
    expect(ctx.replier.reply).not.toHaveBeenCalled();
  });
});

describe('[Happy/Error] delete_cancel', () => {
  it('紀錄存在 → 已取消刪除，且絕不刪除', async () => {
    const ctx = setup();
    await ctx.handler.handle({ data: 'action=delete_cancel&id=10' }, ctx.replier);
    expect(ctx.replies).toEqual([[{ type: 'text', text: '已取消刪除' }]]);
    expect(ctx.deleteById).not.toHaveBeenCalled();
  });

  it('紀錄已不存在 → 仍回「此紀錄已不存在」（implementation-plan P4）', async () => {
    const ctx = setup({ findSummaryById: async () => null });
    await ctx.handler.handle({ data: 'action=delete_cancel&id=10' }, ctx.replier);
    expect(ctx.replies).toEqual([[{ type: 'text', text: '此紀錄已不存在' }]]);
    expect(ctx.deleteById).not.toHaveBeenCalled();
  });
});

describe('[Security/Edge] data 不合法', () => {
  it.each([
    'action=delete&id=abc',
    'action=delete_confirm&id=abc',
    'action=delete_cancel&id=abc',
    'action=delete_confirm&id=0',
    'action=delete_confirm&id=-1',
    'action=delete_confirm&id=1.5',
    'action=delete_confirm&id=2147483648',
    'action=delete_confirm',
    "action=delete_confirm&id=1' OR '1'='1",
  ])('%s → 資料格式錯誤，且不呼叫任何 service', async (data) => {
    const ctx = setup();
    await ctx.handler.handle({ data }, ctx.replier);
    expect(ctx.replies).toEqual([[{ type: 'text', text: '資料格式錯誤，請重新記帳' }]]);
    expect(ctx.findSummaryById).not.toHaveBeenCalled();
    expect(ctx.deleteById).not.toHaveBeenCalled();
    expect(ctx.completePick).not.toHaveBeenCalled();
  });
});
