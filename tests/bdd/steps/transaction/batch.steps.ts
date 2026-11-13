/**
 * LINE 多行批次記帳與逐筆分類的 step。
 * 文字必須與 specs/features/transaction/批次文字記帳.feature、批次逐筆選擇分類.feature 逐字一致。
 *
 *  - 多行訊息以 DocString 傳入（Gherkin 字串參數不能換行）。
 *  - 「最後一次回覆」= world.line.replies 的最後一筆（一個情境可能有多次 webhook）。
 *  - 待分類按鈕的 postback data 含 pending id（DB 自動編號），故點擊步驟以「標籤」從最後一則
 *    Quick Reply 找出 data 直送，不在規格中寫死 id。
 *
 * 執行：npx cucumber-js specs/features/transaction/批次文字記帳.feature
 */
import assert from 'node:assert/strict';
import { DataTable, Then, When } from '@cucumber/cucumber';
import { assertSameRows, messageText } from '../../support/assertions';
import { queryRows } from '../../support/db';
import { postWebhook, postbackEvent, textEvent } from '../../support/line-event-factory';
import type { LineMessage, RecordedReply } from '../../support/stubs';
import { canonFromDb, canonFromExpected, unquote } from '../../support/table-mappers';
import type { TestWorld } from '../../support/world';

const SQL_PENDING =
  'SELECT id, ledger::text AS ledger, entry_type::text AS entry_type, item, amount, ' +
  'occurred_on::text AS occurred_on, note FROM pending_entries ORDER BY batch_id, seq, id';

function lastReply(world: TestWorld): RecordedReply {
  const reply = world.line.replies.at(-1);
  assert.ok(reply, '尚未有任何回覆');
  return reply;
}

function lastMessage(world: TestWorld): LineMessage {
  const message = lastReply(world).messages.at(-1);
  assert.ok(message, '最後一次回覆不含任何訊息');
  return message;
}

function quickReplyItems(message: LineMessage) {
  assert.equal(message.type, 'text', `待分類按鈕應附在 text 訊息上，實際為 ${message.type}`);
  const items = message.type === 'text' ? message.quickReply?.items : undefined;
  assert.ok(items && items.length > 0, `最後一則訊息沒有 Quick Reply：${JSON.stringify(message)}`);
  return items;
}

When('{string} 傳送多行文字訊息：', async function (this: TestWorld, userId: string, text: string) {
  await postWebhook(this, [textEvent(userId, text)]);
});

When(
  '{string} 點擊待分類按鈕 {string}',
  async function (this: TestWorld, userId: string, label: string) {
    const item = quickReplyItems(lastMessage(this)).find((quick) => quick.action.label === label);
    assert.ok(item, `最後一則 Quick Reply 沒有標籤「${label}」的按鈕`);
    await postWebhook(this, [postbackEvent(userId, item.action.data)]);
  },
);

Then('最後一次回覆共 {int} 則訊息', function (this: TestWorld, count: number) {
  const { messages } = lastReply(this);
  assert.equal(messages.length, count, `訊息數不符：${JSON.stringify(messages.map(messageText))}`);
});

Then(
  '最後一次回覆第 {int} 則訊息應為：',
  function (this: TestWorld, index: number, expected: string) {
    const message = lastReply(this).messages[index - 1];
    assert.ok(message, `最後一次回覆沒有第 ${index} 則訊息`);
    assert.equal(messageText(message), expected);
  },
);

// 最後一則訊息的待分類按鈕：action=bpick、id 為目前第一筆待分類項目、categoryId 與表格一致
Then('最後一次回覆的待分類按鈕應為：', async function (this: TestWorld, table: DataTable) {
  const items = quickReplyItems(lastMessage(this));
  const pendingRows = await queryRows<{ id: number }>(this.prisma, SQL_PENDING);
  const pendingIds = new Set(pendingRows.map((row) => String(row.id)));

  const actual = items.map((quick) => {
    const params = new URLSearchParams(quick.action.data);
    assert.equal(params.get('action'), 'bpick', `data 的 action 應為 bpick：${quick.action.data}`);
    assert.ok(
      pendingIds.has(params.get('id') ?? ''),
      `data.id 應指向一筆待分類項目：${quick.action.data}`,
    );
    return { label: quick.action.label, categoryId: Number(params.get('categoryId')) };
  });
  const expected = table.hashes().map((row) => ({
    label: unquote(row['標籤'] ?? ''),
    categoryId: Number(row['分類id']),
  }));
  assert.deepEqual(actual, expected);
});

Then('待分類項目應為：', async function (this: TestWorld, table: DataTable) {
  const headers = table.raw()[0] ?? [];
  const expected = table.hashes().map((row) => canonFromExpected(headers, row));
  const rows = await queryRows<Record<string, unknown>>(this.prisma, SQL_PENDING);
  assertSameRows(
    '待分類項目',
    rows.map((row) => canonFromDb(headers, row)),
    expected,
  );
});

Then('待分類項目應為空', async function (this: TestWorld) {
  const rows = await queryRows<Record<string, unknown>>(this.prisma, SQL_PENDING);
  assert.equal(rows.length, 0, `待分類項目應為空，實際：${JSON.stringify(rows)}`);
});
