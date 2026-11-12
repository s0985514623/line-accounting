/**
 * 共用 LINE step：W1、W2（command）、T1、T1n（readmodel-then）。
 * 文字必須與 specs/features/**.feature 逐字一致。
 *
 * 執行：npx cucumber-js [specs/features/<domain>]    乾跑：npm run test:bdd:dry
 */
import assert from 'node:assert/strict';
import { Then, When } from '@cucumber/cucumber';
import { messageText, requireSingleReply } from '../../support/assertions';
import { postWebhook, postbackEvent, textEvent } from '../../support/line-event-factory';
import type { TestWorld } from '../../support/world';

// W1：送出已簽章的文字訊息事件（HTTP 200）
When(
  '{string} 傳送文字訊息 {string}',
  async function (this: TestWorld, userId: string, text: string) {
    await postWebhook(this, [textEvent(userId, text)]);
  },
);

// W2：送出已簽章的 postback 事件；data 原字串直送，不重新編碼
When(
  '{string} 點擊 postback {string}',
  async function (this: TestWorld, userId: string, data: string) {
    await postWebhook(this, [postbackEvent(userId, data)]);
  },
);

// T1：恰一次 reply，且「第一則訊息」的文字（text 或 template 本文）完全相等
Then('回覆訊息應為 {string}', function (this: TestWorld, expected: string) {
  const reply = requireSingleReply(this);
  const first = reply.messages[0];
  assert.ok(first, 'reply 不含任何訊息');
  assert.equal(messageText(first), expected);
});

// T1n：沒有任何 reply（例如非白名單的 postback）
Then('不回覆任何訊息', function (this: TestWorld) {
  assert.equal(
    this.line.replies.length,
    0,
    `不應回覆任何訊息，實際回覆：${JSON.stringify(this.line.replies)}`,
  );
});
