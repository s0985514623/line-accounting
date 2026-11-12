/**
 * 單元測試：LineMessagingGateway（domain LineMessage → LINE SDK replyMessage 請求）
 *
 * 執行：npx vitest run tests/unit/line/line-messaging-gateway.test.ts    （或 npm run test:unit）
 *
 * 契約（nodejs-master 請遵循）：
 *   src/adapters/line-messaging-gateway.ts
 *     export interface ReplyMessageClient {
 *       replyMessage(request: { replyToken: string; messages: unknown[] }): Promise<unknown>;
 *     }                                   // 結構相容 @line/bot-sdk 的 messagingApi.MessagingApiClient
 *     export class LineMessagingGateway implements LineReplyGateway {
 *       constructor(client: ReplyMessageClient, logger: pino.Logger)
 *       reply(replyToken: string, messages: LineMessage[]): Promise<void>   // SDK 拋錯時只 log（warn 以上），不拋出
 *     }
 * 依據：implementation-plan P1-3；LineMessage 結構同 SDK JSON，故轉換結果須結構等價（不得遺失欄位）。
 */
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { LineMessagingGateway } from '../../../src/adapters/line-messaging-gateway';
import { createLogger } from '../../../src/logging/logger';
import type { LineMessage } from '../../../src/ports/line-reply-gateway';

interface SentRequest {
  replyToken: string;
  messages: unknown[];
}

function fakeClient(failWith?: unknown) {
  const sent: SentRequest[] = [];
  return {
    sent,
    client: {
      async replyMessage(request: SentRequest): Promise<unknown> {
        sent.push(structuredClone(request));
        if (failWith !== undefined) throw failWith;
        return {};
      },
    },
  };
}

function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, logger: createLogger({ level: 'info', destination: stream }) };
}

const TOKEN = 'reply-token-1';

describe('[Happy] 訊息格式轉換', () => {
  it('text 訊息', async () => {
    const { client, sent } = fakeClient();
    const gateway = new LineMessagingGateway(client, captureLogger().logger);
    await gateway.reply(TOKEN, [{ type: 'text', text: '此服務不開放使用' }]);
    expect(sent).toEqual([
      { replyToken: TOKEN, messages: [{ type: 'text', text: '此服務不開放使用' }] },
    ]);
  });

  it('textWithQuickReply：quickReply items 的 postback label / data / displayText 完整保留', async () => {
    const { client, sent } = fakeClient();
    const gateway = new LineMessagingGateway(client, captureLogger().logger);
    const message: LineMessage = {
      type: 'text',
      text: '請選擇「午餐 120 元」的分類',
      quickReply: {
        items: [
          {
            type: 'action',
            action: { type: 'postback', label: '餐飲', data: 'a=pick&c=1', displayText: '餐飲' },
          },
          {
            type: 'action',
            action: { type: 'postback', label: '其他', data: 'a=pick&c=7', displayText: '其他' },
          },
        ],
      },
    };
    await gateway.reply(TOKEN, [message]);
    expect(sent[0]?.messages).toEqual([message]);
  });

  it('buttons template：altText、text、postback actions', async () => {
    const { client, sent } = fakeClient();
    const gateway = new LineMessagingGateway(client, captureLogger().logger);
    const message: LineMessage = {
      type: 'template',
      altText: '已記帳｜個人｜支出｜午餐 120 元',
      template: {
        type: 'buttons',
        text: '已記帳｜個人｜支出｜午餐 120 元',
        actions: [{ type: 'postback', label: '刪除', data: 'a=del&t=1' }],
      },
    };
    await gateway.reply(TOKEN, [message]);
    expect(sent[0]?.messages).toEqual([message]);
  });

  it('confirm template：兩個 postback 按鈕', async () => {
    const { client, sent } = fakeClient();
    const gateway = new LineMessagingGateway(client, captureLogger().logger);
    const message: LineMessage = {
      type: 'template',
      altText: '確定刪除？午餐 120 元（2026-11-12）',
      template: {
        type: 'confirm',
        text: '確定刪除？午餐 120 元（2026-11-12）',
        actions: [
          { type: 'postback', label: '確定', data: 'a=dc&t=1' },
          { type: 'postback', label: '取消', data: 'a=dx&t=1' },
        ],
      },
    };
    await gateway.reply(TOKEN, [message]);
    expect(sent[0]?.messages).toEqual([message]);
  });

  it('buttons template 的 uri action（圖表連結）', async () => {
    const { client, sent } = fakeClient();
    const gateway = new LineMessagingGateway(client, captureLogger().logger);
    const message: LineMessage = {
      type: 'template',
      altText: '查看圖表',
      template: {
        type: 'buttons',
        text: '查看圖表',
        actions: [
          { type: 'uri', label: '開啟圖表', uri: 'https://liff.line.me/test-liff?month=2026-11' },
        ],
      },
    };
    await gateway.reply(TOKEN, [message]);
    expect(sent[0]?.messages).toEqual([message]);
  });

  it('多則訊息維持順序，且一次 replyMessage 送出', async () => {
    const { client, sent } = fakeClient();
    const gateway = new LineMessagingGateway(client, captureLogger().logger);
    await gateway.reply(TOKEN, [
      { type: 'text', text: '第一則' },
      { type: 'text', text: '第二則' },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.messages).toEqual([
      { type: 'text', text: '第一則' },
      { type: 'text', text: '第二則' },
    ]);
  });
});

describe('[Edge] 不改動輸入、不夾帶多餘欄位', () => {
  it('不修改傳入的 messages', async () => {
    const { client } = fakeClient();
    const gateway = new LineMessagingGateway(client, captureLogger().logger);
    const messages: LineMessage[] = [{ type: 'text', text: 'Emoji 😀 與 <b>HTML</b>' }];
    const snapshot = structuredClone(messages);
    await gateway.reply(TOKEN, messages);
    expect(messages).toEqual(snapshot);
  });

  it('text 訊息不帶 quickReply 時，請求中不出現 quickReply 欄位', async () => {
    const { client, sent } = fakeClient();
    const gateway = new LineMessagingGateway(client, captureLogger().logger);
    await gateway.reply(TOKEN, [{ type: 'text', text: 'hi' }]);
    expect(Object.keys((sent[0]?.messages[0] ?? {}) as object).sort()).toEqual(['text', 'type']);
  });
});

describe('[Error] SDK 拋錯只 log 不拋出', () => {
  it('replyMessage reject 時 reply 仍 resolve，並留下 warn 以上等級的 log', async () => {
    const { client } = fakeClient(new Error('LINE API 500'));
    const { logger, lines } = captureLogger();
    const gateway = new LineMessagingGateway(client, logger);
    await expect(gateway.reply(TOKEN, [{ type: 'text', text: 'hi' }])).resolves.toBeUndefined();
    const entries = lines.map((l) => JSON.parse(l) as { level: number });
    expect(entries.some((e) => e.level >= 40)).toBe(true);
  });

  it('非 Error 物件被拋出（例如字串）也不外洩', async () => {
    const { client } = fakeClient('boom');
    const gateway = new LineMessagingGateway(client, captureLogger().logger);
    await expect(gateway.reply(TOKEN, [{ type: 'text', text: 'hi' }])).resolves.toBeUndefined();
  });
});
