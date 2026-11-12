/**
 * report 領域的 Then：T12（月度摘要回覆）、T13（支出分類佔比；LINE 與 LIFF 兩個分支）、T14（圖表連結）。
 * 文字必須與 specs/features/report/*.feature 逐字一致（含全形「：」）。
 *
 * 摘要文字格式（ASM-02；implementation-plan P5-4）：
 *   【個人】2026-11 月度摘要
 *   收入合計：50000 元
 *   支出合計：400 元
 *   結餘：49600 元
 *   支出分類：                      <- 無支出時整個區塊省略
 *   ・餐飲 300 元（75.0%）
 *   ・其他 100 元（25.0%）
 * 回覆為「單次 reply、兩則訊息」：[0] 摘要文字、[1] buttons template（URI action「查看圖表」）。
 *
 * T13 來源判斷：`world.lastResponse` 存在 → LIFF 回應（`expenseByCategory`，P7 使用）；否則 → LINE 回覆。
 * （webhook 步驟不會設定 lastResponse，兩個來源不會混淆。）
 *
 * 執行：npx cucumber-js specs/features/report/查詢月度文字摘要.feature
 * 乾跑：npx cucumber-js specs/features/report/查詢月度文字摘要.feature --dry-run
 */
import assert from 'node:assert/strict';
import { DataTable, Then } from '@cucumber/cucumber';
import { assertSameRows, requireSingleReply } from '../../support/assertions';
import type { LineMessage } from '../../support/stubs';
import { mapLedger, unquote, type Canon } from '../../support/table-mappers';
import type { TestWorld } from '../../support/world';

interface ParsedCategoryLine {
  name: string;
  amount: string;
  ratio: string;
}

interface ParsedSummary {
  ledger: string;
  month: string;
  income: string;
  expense: string;
  balance: string;
  /** 是否出現「支出分類：」標題行。 */
  hasCategoryBlock: boolean;
  categories: ParsedCategoryLine[];
}

const HEADER_PATTERN = /^【(個人|公司)】(\d{4}-\d{2}) 月度摘要$/;
const CATEGORY_LINE_PATTERN = /^・(.+) (\d+) 元（(\d+\.\d)%）$/;

function expectLine(lines: string[], index: number, label: string): string {
  const line = lines[index];
  assert.ok(line !== undefined, `摘要缺少第 ${index + 1} 行「${label}」：${JSON.stringify(lines)}`);
  const match = new RegExp(`^${label}：(-?\\d+) 元$`).exec(line);
  assert.ok(match, `第 ${index + 1} 行應為「${label}：{整數} 元」，實際為：${line}`);
  return String(Number(match[1]));
}

/** 嚴格解析摘要文字（多餘行、順序錯誤、缺行皆視為失敗）。 */
function parseSummary(text: string): ParsedSummary {
  const lines = text.split('\n');
  const header = HEADER_PATTERN.exec(lines[0] ?? '');
  assert.ok(header, `第 1 行應為「【帳本】YYYY-MM 月度摘要」，實際為：${lines[0]}`);

  const income = expectLine(lines, 1, '收入合計');
  const expense = expectLine(lines, 2, '支出合計');
  const balance = expectLine(lines, 3, '結餘');

  const rest = lines.slice(4);
  const categories: ParsedCategoryLine[] = [];
  let hasCategoryBlock = false;
  if (rest.length > 0) {
    assert.equal(rest[0], '支出分類：', `第 5 行應為「支出分類：」，實際為：${rest[0]}`);
    hasCategoryBlock = true;
    for (const line of rest.slice(1)) {
      const match = CATEGORY_LINE_PATTERN.exec(line);
      assert.ok(match, `分類行應為「・{分類} {金額} 元（{佔比}%）」，實際為：${line}`);
      categories.push({
        name: match[1] as string,
        amount: String(Number(match[2])),
        ratio: `${match[3]}%`,
      });
    }
  }

  return {
    ledger: header[1] as string,
    month: header[2] as string,
    income,
    expense,
    balance,
    hasCategoryBlock,
    categories,
  };
}

/** 取得本次 reply 的第 index 則訊息。 */
function replyMessage(world: TestWorld, index: number): LineMessage {
  const reply = requireSingleReply(world);
  const message = reply.messages[index];
  assert.ok(
    message,
    `reply 應含第 ${index + 1} 則訊息，實際共 ${reply.messages.length} 則：${JSON.stringify(reply.messages)}`,
  );
  return message;
}

/** 第一則訊息必須是 text，回傳解析後的摘要。 */
function parseFirstMessageAsSummary(world: TestWorld): ParsedSummary {
  const first = replyMessage(world, 0);
  assert.equal(first.type, 'text', `摘要應為 text 訊息，實際為 ${first.type}`);
  if (first.type !== 'text') throw new Error('unreachable');
  return parseSummary(first.text);
}

// T12：解析摘要文字的帳本、月份、三個合計
Then('月度摘要回覆應為：', function (this: TestWorld, table: DataTable) {
  const summary = parseFirstMessageAsSummary(this);
  const headers = table.raw()[0] ?? [];
  const actualAll: Record<string, string> = {
    帳本: summary.ledger,
    月份: summary.month,
    收入合計: summary.income,
    支出合計: summary.expense,
    結餘: summary.balance,
  };
  const expected: Canon[] = table.hashes().map((row) => {
    const canon: Canon = {};
    for (const header of headers) {
      const raw = unquote(row[header] ?? '');
      canon[header] = ['收入合計', '支出合計', '結餘'].includes(header) ? String(Number(raw)) : raw;
    }
    return canon;
  });
  const actual: Canon[] = [
    Object.fromEntries(
      headers.map((header) => {
        const value = actualAll[header];
        assert.ok(value !== undefined, `月度摘要不支援的欄位：${header}`);
        return [header, value];
      }),
    ),
  ];
  assertSameRows('月度摘要', actual, expected);
});

/** 取得 LIFF 回應的 expenseByCategory（欄位 → 分類 / 金額 / 佔比 字串）。 */
function liffCategoryRows(world: TestWorld): ParsedCategoryLine[] {
  const response = world.lastResponse;
  assert.ok(response, '尚未發出任何 LIFF 請求');
  assert.equal(response.status, 200, `預期 HTTP 200，實際 ${response.status}：${response.text}`);
  const list: unknown = response.body?.expenseByCategory;
  assert.ok(Array.isArray(list), `回應必須含 expenseByCategory 陣列：${response.text}`);
  return (list as Array<{ categoryName: string; amount: number; ratio: number }>).map((item) => ({
    name: item.categoryName,
    amount: String(item.amount),
    ratio: `${item.ratio.toFixed(1)}%`,
  }));
}

function actualCategoryRows(world: TestWorld): ParsedCategoryLine[] {
  if (world.lastResponse) return liffCategoryRows(world);
  return parseFirstMessageAsSummary(world).categories;
}

// T13：依金額由大到小；順序必須完全相同
Then('支出分類佔比應為：', function (this: TestWorld, table: DataTable) {
  const headers = table.raw()[0] ?? [];
  const expected: Canon[] = table.hashes().map((row) => {
    const canon: Canon = {};
    for (const header of headers) {
      const raw = unquote(row[header] ?? '');
      canon[header] = header === '金額' ? String(Number(raw)) : raw;
    }
    return canon;
  });
  const actual: Canon[] = actualCategoryRows(this).map((row) => {
    const all: Record<string, string> = { 分類: row.name, 金額: row.amount, 佔比: row.ratio };
    return Object.fromEntries(
      headers.map((header) => {
        const value = all[header];
        assert.ok(value !== undefined, `支出分類佔比不支援的欄位：${header}`);
        return [header, value];
      }),
    );
  });
  assertSameRows('支出分類佔比', actual, expected);
});

// T13（空）：LINE 先確認「確有摘要回覆」再確認無分類區塊，避免「沒回覆」被誤判為「無分類」
Then('支出分類佔比應為空', function (this: TestWorld) {
  if (this.lastResponse) {
    assert.deepEqual(liffCategoryRows(this), [], 'expenseByCategory 應為空陣列');
    return;
  }
  const summary = parseFirstMessageAsSummary(this);
  assert.equal(summary.hasCategoryBlock, false, '無支出時不應出現「支出分類：」區塊');
  assert.deepEqual(summary.categories, [], '無支出時不應列出任何分類行');
});

// T14：第二則 buttons template 的 URI action；解析 query 的 month、ledger（中文 → enum）
Then('回覆應附圖表連結，參數為：', function (this: TestWorld, table: DataTable) {
  const second = replyMessage(this, 1);
  assert.equal(second.type, 'template', `第二則應為 template 訊息，實際為 ${second.type}`);
  if (second.type !== 'template') return;
  assert.equal(second.template.type, 'buttons', 'template 應為 buttons');
  const uriActions = second.template.actions.filter((action) => action.type === 'uri');
  assert.equal(
    uriActions.length,
    1,
    `應恰有 1 個 URI action，實際：${JSON.stringify(second.template.actions)}`,
  );
  const action = uriActions[0];
  assert.ok(action && action.type === 'uri');

  const url = new URL(action.uri);
  assert.equal(
    url.origin,
    'https://liff.line.me',
    `連結應指向 https://liff.line.me：${action.uri}`,
  );
  assert.equal(
    url.pathname,
    `/${this.config.liffId}/chart`,
    `連結路徑應為 /{LIFF_ID}/chart：${action.uri}`,
  );
  assert.deepEqual(
    [...url.searchParams.keys()].sort(),
    ['ledger', 'month'],
    `query 參數應恰為 month 與 ledger：${action.uri}`,
  );

  const rows = table.hashes();
  assert.equal(rows.length, 1, '圖表連結參數表應只有一列');
  const row = rows[0] as Record<string, string>;
  assert.equal(url.searchParams.get('month'), unquote(row['月份'] ?? ''), 'month 參數不符');
  assert.equal(url.searchParams.get('ledger'), mapLedger(row['帳本'] ?? ''), 'ledger 參數不符');
});
