/**
 * 共用 LINE 回覆 Then（readmodel-then）：T1、T1n。
 * 文字必須與 specs/features/**.feature 逐字一致。
 *
 * 執行：npx cucumber-js [specs/features/<domain>]    乾跑：npm run test:bdd:dry
 */
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { messageText, requireSingleReply } from '../../support/assertions';
import type { TestWorld } from '../../support/world';

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
