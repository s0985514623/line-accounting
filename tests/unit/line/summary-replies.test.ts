/**
 * 單元測試：月度文字摘要的 LINE 回覆 builder（純函式）
 *
 * 執行：npx vitest run tests/unit/line/summary-replies.test.ts
 *
 * 契約（nodejs-master 請遵循）：src/line/messages/summary-replies.ts（型別來自 src/domain/monthly-report.ts、src/ports/line-reply-gateway.ts）
 *   export function buildSummaryReply(report: MonthlyReport): TextMessage;
 *     // ASM-02 格式（以 '\n' 連接、結尾無換行、金額不加千分位）：
 *     //   【個人】2026-11 月度摘要           （帳本中文標籤 個人/公司）
 *     //   收入合計：50000 元
 *     //   支出合計：400 元
 *     //   結餘：49600 元                    （負數照原樣：結餘：-90 元）
 *     //   支出分類：                         （expenseByCategory 為空時，此行與以下分類行全部省略）
 *     //   ・餐飲 300 元（75.0%）              （依 report.expenseByCategory 既有順序輸出，不重新排序；ratio 一律 toFixed(1) 加 %）
 *     // 無 quickReply。
 *   export function buildChartUrl(liffId: string, ledger: Ledger, month: string): string;
 *     // `https://liff.line.me/{liffId}/chart?month={month}&ledger={personal|company}`（參數順序固定 month、ledger）
 *   export function buildChartLinkReply(report: Pick<MonthlyReport, 'ledger' | 'month'>, liffId: string): TemplateMessage;
 *     // template.type='buttons'；actions 恰一個 { type:'uri', label:'查看圖表', uri: buildChartUrl(...) }；
 *     // template.text 非空且 ≤ 160、altText 非空且 ≤ 400（本文措辭不釘死）
 *   export function buildSummaryReplies(report: MonthlyReport, liffId: string): [TextMessage, TemplateMessage];
 *     // 同一次 reply 的兩則訊息：[摘要文字, 圖表連結]
 * 依據：implementation-plan P5-4、ASM-02；specs/features/report/查詢月度文字摘要.feature。
 */
import { describe, expect, it } from 'vitest';
import type { MonthlyReport } from '../../../src/domain/monthly-report';
import {
  buildChartLinkReply,
  buildChartUrl,
  buildSummaryReplies,
  buildSummaryReply,
} from '../../../src/line/messages/summary-replies';

const LIFF_ID = '2000000000-AbCdEfGh';

function report(overrides: Partial<MonthlyReport> = {}): MonthlyReport {
  return {
    ledger: 'personal',
    month: '2026-11',
    incomeTotal: 50000,
    expenseTotal: 400,
    balance: 49600,
    expenseByCategory: [
      { categoryId: 1, categoryName: '餐飲', amount: 300, ratio: 75 },
      { categoryId: 2, categoryName: '其他', amount: 100, ratio: 25 },
    ],
    incomeByCategory: [],
    ...overrides,
  };
}

describe('[Smoke] buildSummaryReply：規格範例逐字比對', () => {
  it('個人 2026-11（ASM-02 範例）', () => {
    expect(buildSummaryReply(report())).toEqual({
      type: 'text',
      text: [
        '【個人】2026-11 月度摘要',
        '收入合計：50000 元',
        '支出合計：400 元',
        '結餘：49600 元',
        '支出分類：',
        '・餐飲 300 元（75.0%）',
        '・其他 100 元（25.0%）',
      ].join('\n'),
    });
  });

  it('有收入分類時接在支出分類之後', () => {
    const text = buildSummaryReply(
      report({
        incomeByCategory: [
          { categoryId: 3, categoryName: '薪資', amount: 50000, ratio: 83.3 },
          { categoryId: 4, categoryName: '獎金', amount: 10000, ratio: 16.7 },
        ],
      }),
    ).text;
    expect(text.split('\n').slice(4)).toEqual([
      '支出分類：',
      '・餐飲 300 元（75.0%）',
      '・其他 100 元（25.0%）',
      '收入分類：',
      '・薪資 50000 元（83.3%）',
      '・獎金 10000 元（16.7%）',
    ]);
  });

  it('公司 2026-11：66.7% / 33.3%', () => {
    const text = buildSummaryReply(
      report({
        ledger: 'company',
        incomeTotal: 30000,
        expenseTotal: 300,
        balance: 29700,
        expenseByCategory: [
          { categoryId: 6, categoryName: '其他', amount: 200, ratio: 66.7 },
          { categoryId: 5, categoryName: '文具', amount: 100, ratio: 33.3 },
        ],
      }),
    ).text;
    expect(text).toBe(
      [
        '【公司】2026-11 月度摘要',
        '收入合計：30000 元',
        '支出合計：300 元',
        '結餘：29700 元',
        '支出分類：',
        '・其他 200 元（66.7%）',
        '・文具 100 元（33.3%）',
      ].join('\n'),
    );
  });
});

describe('[Happy] 無支出時省略「支出分類：」區塊', () => {
  it('公司上月全為 0 → 只有標題與三行合計，結尾無換行', () => {
    const message = buildSummaryReply(
      report({
        ledger: 'company',
        month: '2026-10',
        incomeTotal: 0,
        expenseTotal: 0,
        balance: 0,
        expenseByCategory: [],
      }),
    );
    expect(message.text).toBe(
      ['【公司】2026-10 月度摘要', '收入合計：0 元', '支出合計：0 元', '結餘：0 元'].join('\n'),
    );
    expect(message.text).not.toContain('支出分類');
    expect(message.text).not.toContain('・');
    expect(message.text.endsWith('\n')).toBe(false);
  });

  it('只有收入、沒有支出 → 不列分類（收入只列合計）', () => {
    const { text } = buildSummaryReply(
      report({ incomeTotal: 100, expenseTotal: 0, balance: 100, expenseByCategory: [] }),
    );
    expect(text).toBe(
      ['【個人】2026-11 月度摘要', '收入合計：100 元', '支出合計：0 元', '結餘：100 元'].join('\n'),
    );
  });

  it('回覆為純 text 訊息，不帶 quickReply', () => {
    expect(buildSummaryReply(report())).not.toHaveProperty('quickReply');
  });
});

describe('[Edge] 數字與佔比格式', () => {
  it('負結餘照原樣輸出「結餘：-90 元」', () => {
    const { text } = buildSummaryReply(
      report({
        month: '2026-10',
        incomeTotal: 0,
        expenseTotal: 90,
        balance: -90,
        expenseByCategory: [{ categoryId: 1, categoryName: '餐飲', amount: 90, ratio: 100 }],
      }),
    );
    expect(text).toContain('結餘：-90 元');
    expect(text).toContain('・餐飲 90 元（100.0%）');
  });

  it('金額不加千分位（8 位數上限 99999999）', () => {
    const { text } = buildSummaryReply(
      report({
        incomeTotal: 99_999_999,
        expenseTotal: 12_345_678,
        balance: 87_654_321,
        expenseByCategory: [
          { categoryId: 1, categoryName: '餐飲', amount: 12_345_678, ratio: 100 },
        ],
      }),
    );
    expect(text).toContain('收入合計：99999999 元');
    expect(text).toContain('支出合計：12345678 元');
    expect(text).toContain('結餘：87654321 元');
    expect(text).not.toMatch(/\d,\d{3}/);
  });

  it.each([
    [75, '75.0%'],
    [25, '25.0%'],
    [100, '100.0%'],
    [0, '0.0%'],
    [0.1, '0.1%'],
    [12.5, '12.5%'],
    [33.3, '33.3%'],
    [66.7, '66.7%'],
  ])('ratio %s → 「%s」（一律小數一位）', (ratio, expected) => {
    const { text } = buildSummaryReply(
      report({ expenseByCategory: [{ categoryId: 1, categoryName: '餐飲', amount: 1, ratio }] }),
    );
    expect(text).toContain(`・餐飲 1 元（${expected}）`);
  });

  it('依 expenseByCategory 既有順序輸出，不自行重排（排序屬於 monthly-report）', () => {
    const { text } = buildSummaryReply(
      report({
        expenseByCategory: [
          { categoryId: 9, categoryName: '甲', amount: 1, ratio: 10 },
          { categoryId: 1, categoryName: '乙', amount: 9, ratio: 90 },
        ],
      }),
    );
    expect(text.indexOf('・甲')).toBeLessThan(text.indexOf('・乙'));
  });

  it('分類名稱原樣輸出（Emoji、符號、含空白）', () => {
    const { text } = buildSummaryReply(
      report({
        expenseByCategory: [
          { categoryId: 1, categoryName: '☕ 咖啡 & 茶=1', amount: 5, ratio: 100 },
        ],
      }),
    );
    expect(text).toContain('・☕ 咖啡 & 茶=1 5 元（100.0%）');
  });

  it('標題的月份與帳本取自 report（跨年月份 2025-12）', () => {
    const { text } = buildSummaryReply(report({ month: '2025-12' }));
    expect(text.split('\n')[0]).toBe('【個人】2025-12 月度摘要');
  });
});

describe('[Happy] buildChartUrl', () => {
  it('公司 2026-10', () => {
    expect(buildChartUrl(LIFF_ID, 'company', '2026-10')).toBe(
      `https://liff.line.me/${LIFF_ID}/chart?month=2026-10&ledger=company`,
    );
  });

  it('個人 2026-11（ledger 用 enum 值 personal，不用中文）', () => {
    expect(buildChartUrl(LIFF_ID, 'personal', '2026-11')).toBe(
      `https://liff.line.me/${LIFF_ID}/chart?month=2026-11&ledger=personal`,
    );
  });
});

describe('[Happy] buildChartLinkReply：buttons template + URI action', () => {
  it('公司 2026-10 → 單一「查看圖表」URI 按鈕，連結帶入同一帳本與月份', () => {
    const message = buildChartLinkReply({ ledger: 'company', month: '2026-10' }, LIFF_ID);
    expect(message.type).toBe('template');
    expect(message.template.type).toBe('buttons');
    expect(message.template.actions).toEqual([
      {
        type: 'uri',
        label: '查看圖表',
        uri: `https://liff.line.me/${LIFF_ID}/chart?month=2026-10&ledger=company`,
      },
    ]);
  });

  it('LINE 長度限制：本文 1–160、altText 1–400、URI ≤ 1000、label ≤ 20', () => {
    const message = buildChartLinkReply({ ledger: 'personal', month: '2026-11' }, LIFF_ID);
    expect(message.template.text.length).toBeGreaterThan(0);
    expect(message.template.text.length).toBeLessThanOrEqual(160);
    expect(message.altText.length).toBeGreaterThan(0);
    expect(message.altText.length).toBeLessThanOrEqual(400);
    const action = message.template.actions[0];
    expect(action?.label.length).toBeLessThanOrEqual(20);
    expect(action?.type === 'uri' && action.uri.length).toBeLessThanOrEqual(1000);
  });
});

describe('[Happy] buildSummaryReplies：一次 reply 兩則訊息', () => {
  it('依序為 [摘要文字, 圖表連結]，圖表連結的帳本與月份取自 report', () => {
    const input = report({ ledger: 'company', month: '2026-10' });
    const messages = buildSummaryReplies(input, LIFF_ID);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(buildSummaryReply(input));
    expect(messages[1]).toEqual(buildChartLinkReply(input, LIFF_ID));
    const action = messages[1].template.actions[0];
    expect(action?.type === 'uri' && action.uri).toBe(
      `https://liff.line.me/${LIFF_ID}/chart?month=2026-10&ledger=company`,
    );
  });

  it('無支出的月份仍附圖表連結（規格：公 上月 仍可看圖表頁）', () => {
    const messages = buildSummaryReplies(
      report({
        ledger: 'company',
        month: '2026-10',
        incomeTotal: 0,
        expenseTotal: 0,
        balance: 0,
        expenseByCategory: [],
      }),
      LIFF_ID,
    );
    expect(messages).toHaveLength(2);
    expect(messages[0].text).not.toContain('支出分類');
    expect(messages[1].type).toBe('template');
  });
});
