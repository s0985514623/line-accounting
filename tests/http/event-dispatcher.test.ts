/**
 * HTTP 測試：webhook 事件分派（白名單、來源過濾、單事件隔離）
 *
 * 執行：TEST_DATABASE_URL=postgresql://test:test@localhost:5434/test npx vitest run tests/http/event-dispatcher.test.ts
 *
 * 契約（nodejs-master 請遵循）：
 *   - src/line/event-dispatcher.ts：事件逐一處理、每個事件各自 try/catch（一個失敗不影響其他、HTTP 仍 200）；
 *     `source.type !== 'user'`（group / room）一律忽略，不回覆、不寫入（ASM-11）；
 *     非白名單 userId：follow / message 回覆「此服務不開放使用」，postback 不回覆；
 *     不支援的事件類型（unfollow 等）靜默忽略。
 * 依據：implementation-plan P1-2、ASM-11、specs/api/api.yml `/webhook/line`。
 * 說明：非白名單 follow 已被 加入好友.feature 覆蓋；此處補 BDD 未涵蓋的 message / postback / 群組 / 隔離。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  followEvent,
  postbackEvent,
  textEvent,
  type LineEvent,
} from '../bdd/support/line-event-factory';
import { RecordingLineGateway } from '../bdd/support/stubs';
import {
  createWebhookHarness,
  postSigned,
  webhookBody,
  type WebhookHarness,
} from './support/webhook-harness';

const NOT_ALLOWED = '此服務不開放使用';

let harness: WebhookHarness;

beforeAll(async () => {
  harness = await createWebhookHarness();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
});

/** 送出已簽章事件並斷言 HTTP 200（業務結果不反映在 HTTP 狀態）。 */
async function deliver(app: Parameters<typeof postSigned>[0], events: LineEvent[]) {
  const response = await postSigned(app, webhookBody(events));
  expect(response.status).toBe(200);
}

function inGroup(event: LineEvent): LineEvent {
  return {
    ...event,
    source: { type: 'group', groupId: 'C-group', userId: 'U-owner' },
  } as unknown as LineEvent;
}

function inRoom(event: LineEvent): LineEvent {
  return {
    ...event,
    source: { type: 'room', roomId: 'R-room', userId: 'U-owner' },
  } as unknown as LineEvent;
}

function firstText(line: RecordingLineGateway): string | undefined {
  const first = line.replies[0]?.messages[0];
  if (!first) return undefined;
  return first.type === 'text' ? first.text : first.template.text;
}

describe('[Security] 非白名單使用者', () => {
  it('follow：回「此服務不開放使用」，不建立任何分類', async () => {
    const { app, line } = harness.makeApp();
    const response = await postSigned(app, webhookBody([followEvent('U-stranger')]));
    expect(response.status).toBe(200);
    expect(line.replies).toHaveLength(1);
    expect(firstText(line)).toBe(NOT_ALLOWED);
    expect(await harness.countRows('categories')).toBe(0);
  });

  it('文字訊息（含看似合法的記帳格式）：回「此服務不開放使用」，不建立任何資料', async () => {
    const { app, line } = harness.makeApp();
    const response = await postSigned(app, webhookBody([textEvent('U-stranger', '午餐 120')]));
    expect(response.status).toBe(200);
    expect(line.replies).toHaveLength(1);
    expect(firstText(line)).toBe(NOT_ALLOWED);
    expect(await harness.countRows('transactions')).toBe(0);
    expect(await harness.countRows('categories')).toBe(0);
  });

  it('「本月」摘要指令：同樣回「此服務不開放使用」', async () => {
    const { app, line } = harness.makeApp();
    await deliver(app, [textEvent('U-stranger', '本月')]);
    expect(line.replies).toHaveLength(1);
    expect(firstText(line)).toBe(NOT_ALLOWED);
  });

  it('postback：不回覆、不寫入', async () => {
    const { app, line } = harness.makeApp();
    const response = await postSigned(
      app,
      webhookBody([postbackEvent('U-stranger', 'action=delete&id=1')]),
    );
    expect(response.status).toBe(200);
    expect(line.replies).toHaveLength(0);
    expect(await harness.countRows('transactions')).toBe(0);
  });

  it('白名單為其他 userId 時，原擁有者變成非白名單（比對為完全相等，非前綴）', async () => {
    const { app, line } = harness.makeApp({ ownerUserId: 'U-owner-2' });
    await deliver(app, [followEvent('U-owner')]);
    expect(firstText(line)).toBe(NOT_ALLOWED);
    expect(await harness.countRows('categories')).toBe(0);
  });
});

describe('[Edge] 群組 / 聊天室事件忽略（ASM-11）', () => {
  it('群組內擁有者的文字訊息：不回覆、不寫入', async () => {
    const { app, line } = harness.makeApp();
    const response = await postSigned(
      app,
      webhookBody([inGroup(textEvent('U-owner', '午餐 120'))]),
    );
    expect(response.status).toBe(200);
    expect(line.replies).toHaveLength(0);
    expect(await harness.countRows('transactions')).toBe(0);
  });

  it('群組內非白名單者的訊息：同樣忽略（不回「不開放」）', async () => {
    const { app, line } = harness.makeApp();
    await deliver(app, [inGroup(textEvent('U-stranger', 'hi'))]);
    expect(line.replies).toHaveLength(0);
  });

  it('群組 follow（Bot 被加入群組情境）：不建立分類、不回覆', async () => {
    const { app, line } = harness.makeApp();
    await deliver(app, [inGroup(followEvent('U-owner'))]);
    expect(line.replies).toHaveLength(0);
    expect(await harness.countRows('categories')).toBe(0);
  });

  it('room 來源的 postback：忽略', async () => {
    const { app, line } = harness.makeApp();
    await deliver(app, [inRoom(postbackEvent('U-owner', 'action=delete&id=1'))]);
    expect(line.replies).toHaveLength(0);
  });
});

describe('[Edge] 不支援的事件類型', () => {
  it('unfollow：200、不回覆、不寫入', async () => {
    const { app, line } = harness.makeApp();
    const unfollow = { ...followEvent('U-owner'), type: 'unfollow' } as unknown as LineEvent;
    delete (unfollow as { replyToken?: string }).replyToken;
    const response = await postSigned(app, webhookBody([unfollow]));
    expect(response.status).toBe(200);
    expect(line.replies).toHaveLength(0);
    expect(await harness.countRows('categories')).toBe(0);
  });

  it('未知事件類型：200 且忽略', async () => {
    const { app, line } = harness.makeApp();
    const unknown = { ...followEvent('U-owner'), type: 'someFutureEvent' } as unknown as LineEvent;
    const response = await postSigned(app, webhookBody([unknown]));
    expect(response.status).toBe(200);
    expect(line.replies).toHaveLength(0);
  });
});

describe('[Error] 單事件失敗隔離', () => {
  it('第一個事件的 reply 拋錯，第二個事件仍被處理且 HTTP 200', async () => {
    let calls = 0;
    const flaky = new RecordingLineGateway();
    const originalReply = flaky.reply.bind(flaky);
    flaky.reply = async (replyToken, messages) => {
      calls += 1;
      if (calls === 1) throw new Error('LINE API 暫時失敗');
      await originalReply(replyToken, messages);
    };
    const { app } = harness.makeApp({ line: flaky });
    const response = await postSigned(
      app,
      webhookBody([followEvent('U-owner'), followEvent('U-stranger')]),
    );
    expect(response.status).toBe(200);
    expect(calls).toBe(2);
    expect(flaky.replies).toHaveLength(1);
    expect(firstText(flaky)).toBe(NOT_ALLOWED);
  });

  it('一次多個事件依序全部處理（白名單 follow + 非白名單 message）', async () => {
    const { app, line } = harness.makeApp();
    await deliver(app, [followEvent('U-owner'), textEvent('U-stranger', 'hi')]);
    expect(line.replies).toHaveLength(2);
    expect(firstText(line)?.startsWith('歡迎使用 LINE 記帳')).toBe(true);
    expect(await harness.countRows('categories')).toBe(19);
  });
});
