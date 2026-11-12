/**
 * LINE webhook 事件工廠與簽章工具。
 *
 * postWebhook(world, events)：JSON.stringify → HMAC-SHA256(base64, channel secret)
 *   → `x-line-signature` → POST /webhook/line，並斷言 HTTP 200（業務結果不反映在 HTTP 狀態）。
 */
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import type { TestWorld } from './world';
import { TEST_CHANNEL_SECRET } from './stubs';

export interface LineEvent {
  type: 'follow' | 'message' | 'postback' | 'unfollow';
  mode: 'active';
  timestamp: number;
  webhookEventId: string;
  deliveryContext: { isRedelivery: boolean };
  source: { type: 'user'; userId: string };
  replyToken?: string;
  message?: { type: 'text'; id: string; text: string };
  postback?: { data: string };
}

function baseEvent(type: LineEvent['type'], userId: string): LineEvent {
  return {
    type,
    mode: 'active',
    timestamp: Date.now(),
    webhookEventId: randomBytes(13).toString('hex').toUpperCase(),
    deliveryContext: { isRedelivery: false },
    source: { type: 'user', userId },
    replyToken: randomBytes(16).toString('hex'),
  };
}

export function followEvent(userId: string): LineEvent {
  return baseEvent('follow', userId);
}

export function textEvent(userId: string, text: string): LineEvent {
  return {
    ...baseEvent('message', userId),
    message: { type: 'text', id: String(Date.now()), text },
  };
}

/** data 原字串直送，不重新編碼。 */
export function postbackEvent(userId: string, data: string): LineEvent {
  return { ...baseEvent('postback', userId), postback: { data } };
}

export function webhookBody(events: LineEvent[]): string {
  return JSON.stringify({ destination: 'U-bot-destination', events });
}

/** LINE 簽章：HMAC-SHA256(原始 body, channel secret) 的 base64。 */
export function signBody(rawBody: string, secret: string = TEST_CHANNEL_SECRET): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

/** 送出已簽章的 webhook 並斷言 HTTP 200（業務結果以 LINE reply 表達）。 */
export async function postWebhook(world: TestWorld, events: LineEvent[]): Promise<void> {
  const rawBody = webhookBody(events);
  const agent = await world.http();
  const response = await agent
    .post('/webhook/line')
    .set('Content-Type', 'application/json')
    .set('x-line-signature', signBody(rawBody))
    .send(rawBody);
  assert.equal(
    response.status,
    200,
    `webhook 應回 HTTP 200（業務結果以 LINE reply 表達），實際 ${response.status}：${response.text}`,
  );
}
