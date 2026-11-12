/**
 * Then step 共用的斷言輔助（不含 cucumber 相依，可單獨 import）。
 */
import assert from 'node:assert/strict';
import type { Canon } from './table-mappers';
import { describeRows } from './table-mappers';
import type { LineMessage, RecordedReply } from './stubs';
import type { TestWorld } from './world';

/** 取得最近一次 LIFF 回應；尚未發出請求時給出明確錯誤。 */
export function requireResponse(world: TestWorld) {
  assert.ok(world.lastResponse, '尚未發出任何 LIFF 請求（缺少 When 步驟？）');
  return world.lastResponse;
}

/** 完整比對兩張表（含順序）；失敗時以中文標籤列出預期與實際。 */
export function assertSameRows(title: string, actual: Canon[], expected: Canon[]): void {
  try {
    assert.deepStrictEqual(actual, expected);
  } catch {
    assert.fail(
      `${title}不符\n--- 預期 ---\n${describeRows(expected)}\n--- 實際 ---\n${describeRows(actual)}`,
    );
  }
}

/** 訊息的可讀本文：text 訊息取 text；template 訊息取 template.text。 */
export function messageText(message: LineMessage): string {
  if (message.type === 'text') return message.text;
  return message.template.text;
}

/** 斷言恰好回覆一次，並回傳該次 reply。 */
export function requireSingleReply(world: TestWorld): RecordedReply {
  const { replies } = world.line;
  assert.equal(
    replies.length,
    1,
    `應恰好回覆 1 次，實際 ${replies.length} 次：${JSON.stringify(replies)}`,
  );
  return replies[0] as RecordedReply;
}
