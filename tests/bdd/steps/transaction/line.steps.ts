/**
 * transaction 領域的 LINE 回覆 Then：T7（回覆的分類按鈕）、T8（回覆的按鈕）。
 * 文字必須與 specs/features/transaction/*.feature 逐字一致（含全形「：」）。
 *
 * - T7：第一則訊息須為帶 Quick Reply 的 text；逐項比對 label 與 postback data 解析出的 categoryId，
 *       並驗證 data 的 ledger / type 與該分類一致、item / amount 與提示文字一致、date 為今天、同一 token。
 * - T8：第一則訊息須為 template；逐項比對 postback action 的 label 與 data；
 *       `$記帳紀錄.id` 解析為資料庫中唯一一筆記帳紀錄的 id。
 *
 * 執行：npx cucumber-js specs/features/transaction/以文字訊息記帳.feature
 * 乾跑：npx cucumber-js specs/features/transaction/以文字訊息記帳.feature --dry-run
 */
import assert from 'node:assert/strict';
import { DataTable, Then } from '@cucumber/cucumber';
import { requireSingleReply } from '../../support/assertions';
import { queryRows } from '../../support/db';
import type { PostbackAction, TemplateAction } from '../../support/stubs';
import { unquote } from '../../support/table-mappers';
import type { TestWorld } from '../../support/world';

const TX_ID_PLACEHOLDER = '$記帳紀錄.id';

/** 解析 postback data（本專案只跳脫 % & = +，故可直接用 URLSearchParams）。 */
function parseData(data: string): URLSearchParams {
  return new URLSearchParams(data);
}

/** 取得資料庫中唯一一筆記帳紀錄的 id，並記到 world.lastTransactionId。 */
async function resolveSingleTransactionId(world: TestWorld): Promise<number> {
  const rows = await queryRows<{ id: number }>(
    world.prisma,
    'SELECT id FROM transactions ORDER BY id',
  );
  assert.equal(
    rows.length,
    1,
    `解析 ${TX_ID_PLACEHOLDER} 時，記帳紀錄應恰好 1 筆，實際 ${rows.length} 筆`,
  );
  const id = Number((rows[0] as { id: number }).id);
  world.lastTransactionId = id;
  return id;
}

// T7：分類 Quick Reply（標籤、分類id）
Then('回覆的分類按鈕應為：', async function (this: TestWorld, table: DataTable) {
  const reply = requireSingleReply(this);
  const first = reply.messages[0];
  assert.ok(first, 'reply 不含任何訊息');
  assert.equal(first.type, 'text', `分類按鈕應附在 text 訊息上，實際為 ${first.type}`);
  if (first.type !== 'text') return;
  const quickItems = first.quickReply?.items;
  assert.ok(
    quickItems && quickItems.length > 0,
    `第一則訊息沒有 Quick Reply：${JSON.stringify(first)}`,
  );

  const promptMatch = /^請選擇「(.+) (\d+) 元」的分類$/s.exec(first.text);
  assert.ok(promptMatch, `提示文字格式不符「請選擇「{項目} {金額} 元」的分類」：${first.text}`);
  const promptItem = promptMatch[1] as string;
  const promptAmount = promptMatch[2] as string;

  const expected = table.hashes().map((row) => ({
    label: unquote(row['標籤'] ?? ''),
    categoryId: Number(row['分類id']),
  }));

  const actual: Array<{ label: string; categoryId: number }> = [];
  const tokens = new Set<string>();
  for (const quick of quickItems) {
    const action = quick.action;
    assert.equal(action.type, 'postback', 'Quick Reply 按鈕必須是 postback action');
    const params = parseData(action.data);
    assert.equal(params.get('action'), 'pick', `data 的 action 應為 pick：${action.data}`);
    const categoryId = Number(params.get('categoryId'));
    assert.ok(Number.isInteger(categoryId), `data 缺少合法的 categoryId：${action.data}`);
    actual.push({ label: action.label, categoryId });

    // data 其餘欄位須與原訊息一致
    const categoryRows = await queryRows<{ ledger: string; entry_type: string; name: string }>(
      this.prisma,
      `SELECT ledger::text AS ledger, entry_type::text AS entry_type, name FROM categories WHERE id = ${categoryId}`,
    );
    const category = categoryRows[0];
    assert.ok(category, `按鈕指向不存在的分類 id ${categoryId}`);
    assert.equal(
      params.get('ledger'),
      category.ledger,
      `data.ledger 應與分類 ${categoryId} 的帳本一致`,
    );
    assert.equal(
      params.get('type'),
      category.entry_type,
      `data.type 應與分類 ${categoryId} 的收支一致`,
    );
    assert.equal(params.get('item'), promptItem, 'data.item 應與提示文字的項目一致');
    assert.equal(params.get('amount'), promptAmount, 'data.amount 應與提示文字的金額一致');
    assert.equal(params.get('date'), this.clock.today(), 'data.date 應為今天（Asia/Taipei）');
    assert.ok(params.has('note'), 'data 必須含 note 欄位（可為空）');
    assert.equal(action.displayText, category.name, 'displayText 應為完整分類名稱');
    const token = params.get('token');
    assert.ok(token && token.length > 0, `data 缺少 token：${action.data}`);
    tokens.add(token);
  }
  assert.equal(
    tokens.size,
    1,
    `同一則提示的所有按鈕應共用同一個 token，實際：${[...tokens].join(', ')}`,
  );
  assert.deepEqual(
    actual,
    expected,
    `分類按鈕不符\n預期：${JSON.stringify(expected)}\n實際：${JSON.stringify(actual)}`,
  );
});

// T8：template 的 postback 按鈕（標籤、postback）；支援 `$記帳紀錄.id`
Then('回覆的按鈕應為：', async function (this: TestWorld, table: DataTable) {
  const reply = requireSingleReply(this);
  const first = reply.messages[0];
  assert.ok(first, 'reply 不含任何訊息');
  assert.equal(first.type, 'template', `按鈕應附在 template 訊息上，實際為 ${first.type}`);
  if (first.type !== 'template') return;

  const actions: TemplateAction[] = first.template.actions;
  const actual = actions.map((action) => {
    assert.equal(action.type, 'postback', `預期 postback 按鈕，實際為 ${action.type}`);
    const postback = action as PostbackAction;
    return { label: postback.label, postback: postback.data };
  });

  const needsId = table.hashes().some((row) => (row['postback'] ?? '').includes(TX_ID_PLACEHOLDER));
  const transactionId = needsId ? await resolveSingleTransactionId(this) : null;
  const expected = table.hashes().map((row) => ({
    label: unquote(row['標籤'] ?? ''),
    postback: unquote(row['postback'] ?? '').replaceAll(TX_ID_PLACEHOLDER, String(transactionId)),
  }));

  assert.deepEqual(
    actual,
    expected,
    `按鈕不符\n預期：${JSON.stringify(expected)}\n實際：${JSON.stringify(actual)}`,
  );
});
