/**
 * 單元測試：記帳相關 LINE 回覆 builder（純函式）
 *
 * 執行：npx vitest run tests/unit/line/entry-replies.test.ts
 *
 * 契約（nodejs-master 請遵循）——src/line/messages/entry-replies.ts（型別來自 src/ports/line-reply-gateway.ts）：
 *   export const MAX_QUICK_REPLY_ITEMS = 13;        // LINE 上限（ASM-06）
 *   export const MAX_QUICK_REPLY_LABEL_LENGTH = 20; // LINE 上限（ASM-06）
 *   export const MAX_ALT_TEXT_LENGTH = 400;
 *   export const MAX_BUTTONS_TEXT_LENGTH = 160;     // buttons template 本文上限
 *
 *   export interface RecordedSummaryInput {
 *     ledger: Ledger; entryType: EntryType; item: string; amount: number;
 *     categoryName: string; occurredOn: string （YYYY-MM-DD）; transactionId: number;
 *   }
 *   export function buildRecordedReply(input: RecordedSummaryInput): TemplateMessage;
 *     // buttons template；text = 摘要「已記帳｜{帳本}｜{收支}｜{項目} {金額} 元｜分類：{分類}｜{日期}」（金額不加千分位）；
 *     // altText = 同摘要（<= 400）；text 超過 160 時截斷到 <= 160（仍以「已記帳｜」開頭）；
 *     // actions 恰一個 postback：label「刪除」、data = encodeDelete(transactionId)；摘要不含備註。
 *
 *   export interface CategoryChoice { id: number; name: string; isFallback: boolean }
 *   export interface CategoryPromptInput {
 *     token: string; ledger: Ledger; entryType: EntryType; item: string; amount: number;
 *     date: string; note: string | null;
 *     categories: readonly CategoryChoice[];   // 呼叫端已依 id 升冪、且限同帳本同收支
 *   }
 *   export function buildCategoryQuickReply(input: CategoryPromptInput): TextMessage;
 *     // text = 「請選擇「{項目} {金額} 元」的分類」；quickReply.items 每個為 postback：
 *     //   label = 分類名（> 20 字 → 前 19 字 + 「…」，總長 20）、displayText = 完整分類名、
 *     //   data = encodePick({token, ledger, entryType, item, amount, date, note, categoryId})。
 *     // 分類數 <= 13 → 全部、維持輸入順序；> 13 → 前 12 個一般分類（依輸入順序）+ 「其他」(isFallback) 放最後（ASM-06）。
 *     // 任一按鈕 data > 300 字元 → 改回純文字「備註太長，請縮短後重新傳送，或改用表單記帳」且不含 quickReply（ASM-05）。
 */
import { describe, expect, it } from 'vitest';
import { decodePostback, encodeDelete, encodePick } from '../../../src/domain/postback-codec';
import {
  MAX_ALT_TEXT_LENGTH,
  MAX_BUTTONS_TEXT_LENGTH,
  MAX_QUICK_REPLY_ITEMS,
  MAX_QUICK_REPLY_LABEL_LENGTH,
  buildCategoryQuickReply,
  buildRecordedReply,
} from '../../../src/line/messages/entry-replies';

const NOTE_TOO_LONG = '備註太長，請縮短後重新傳送，或改用表單記帳';

// ---- 已記帳摘要 -----------------------------------------------------------------------------

describe('[Smoke] buildRecordedReply：已記帳摘要 + 刪除按鈕', () => {
  it('規格範例：個人支出餐飲 120', () => {
    const message = buildRecordedReply({
      ledger: 'personal',
      entryType: 'expense',
      item: '餐飲',
      amount: 120,
      categoryName: '餐飲',
      occurredOn: '2026-11-12',
      transactionId: 7,
    });
    expect(message).toEqual({
      type: 'template',
      altText: '已記帳｜個人｜支出｜餐飲 120 元｜分類：餐飲｜2026-11-12',
      template: {
        type: 'buttons',
        text: '已記帳｜個人｜支出｜餐飲 120 元｜分類：餐飲｜2026-11-12',
        actions: [{ type: 'postback', label: '刪除', data: 'action=delete&id=7' }],
      },
    });
  });

  it('刪除按鈕 data 與 encodeDelete 一致，且可被 decodePostback 還原', () => {
    const message = buildRecordedReply({
      ledger: 'personal',
      entryType: 'expense',
      item: '午餐',
      amount: 120,
      categoryName: '餐飲',
      occurredOn: '2026-11-12',
      transactionId: 4321,
    });
    const action = message.template.actions[0];
    expect(action).toMatchObject({ type: 'postback', label: '刪除', data: encodeDelete(4321) });
    expect(decodePostback((action as { data: string }).data)).toEqual({
      action: 'delete',
      id: 4321,
    });
  });
});

describe('[Happy] buildRecordedReply：帳本 / 收支 / 金額格式', () => {
  it('公司收入', () => {
    const message = buildRecordedReply({
      ledger: 'company',
      entryType: 'income',
      item: '營業收入',
      amount: 30000,
      categoryName: '營業收入',
      occurredOn: '2026-11-12',
      transactionId: 1,
    });
    expect(message.template.text).toBe(
      '已記帳｜公司｜收入｜營業收入 30000 元｜分類：營業收入｜2026-11-12',
    );
  });

  it('金額不加千分位（ASM-02 一致）：99999999 → 「99999999 元」', () => {
    const message = buildRecordedReply({
      ledger: 'personal',
      entryType: 'income',
      item: '獎金',
      amount: 99999999,
      categoryName: '獎金',
      occurredOn: '2026-01-05',
      transactionId: 1,
    });
    expect(message.template.text).toContain('獎金 99999999 元');
    expect(message.template.text).not.toContain(',');
  });

  it('項目與分類名稱不同時，兩者各自呈現（關鍵字歸類情境）', () => {
    const message = buildRecordedReply({
      ledger: 'personal',
      entryType: 'expense',
      item: '午餐',
      amount: 120,
      categoryName: '餐飲',
      occurredOn: '2026-11-12',
      transactionId: 1,
    });
    expect(message.template.text).toBe('已記帳｜個人｜支出｜午餐 120 元｜分類：餐飲｜2026-11-12');
  });
});

describe('[Edge] buildRecordedReply：長度上限', () => {
  const longInput = {
    ledger: 'personal',
    entryType: 'expense',
    item: '品'.repeat(50),
    amount: 99999999,
    categoryName: '類'.repeat(300),
    occurredOn: '2026-11-12',
    transactionId: 1,
  } as const;

  it('altText 不超過 400 字元', () => {
    const message = buildRecordedReply(longInput);
    expect(MAX_ALT_TEXT_LENGTH).toBe(400);
    expect(message.altText.length).toBeLessThanOrEqual(400);
    expect(message.altText.startsWith('已記帳｜個人｜支出｜')).toBe(true);
  });

  it('buttons 本文不超過 160 字元（LINE 上限），且仍以「已記帳｜」開頭', () => {
    const message = buildRecordedReply(longInput);
    expect(MAX_BUTTONS_TEXT_LENGTH).toBe(160);
    expect(message.template.text.length).toBeLessThanOrEqual(160);
    expect(message.template.text.startsWith('已記帳｜個人｜支出｜')).toBe(true);
  });

  it('一般長度的摘要不被截斷（50 字項目 + 一般分類名 < 160）', () => {
    const message = buildRecordedReply({ ...longInput, categoryName: '餐飲' });
    expect(message.template.text).toBe(
      `已記帳｜個人｜支出｜${'品'.repeat(50)} 99999999 元｜分類：餐飲｜2026-11-12`,
    );
    expect(message.altText).toBe(message.template.text);
  });

  it('刪除按鈕在摘要被截斷時仍存在且 label 為「刪除」（<= 20 字）', () => {
    const message = buildRecordedReply(longInput);
    expect(message.template.actions).toHaveLength(1);
    expect(message.template.actions[0]).toMatchObject({ type: 'postback', label: '刪除' });
  });
});

// ---- 分類 Quick Reply -------------------------------------------------------------------------

const pickBase = {
  token: 'tokenABC123',
  ledger: 'personal',
  entryType: 'expense',
  item: '早餐',
  amount: 80,
  date: '2026-11-12',
  note: null,
} as const;

/** 產生 n 個一般分類（id 1..n，名稱「分類1」…）。 */
function regularCategories(count: number, startId = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    name: `分類${startId + i}`,
    isFallback: false,
  }));
}

function items(message: ReturnType<typeof buildCategoryQuickReply>) {
  return (message.quickReply?.items ?? []).map((item) => item.action);
}

describe('[Smoke] buildCategoryQuickReply：規格範例', () => {
  it('餐飲(1) + 其他(2)：提示文字與按鈕', () => {
    const message = buildCategoryQuickReply({
      ...pickBase,
      categories: [
        { id: 1, name: '餐飲', isFallback: false },
        { id: 2, name: '其他', isFallback: true },
      ],
    });
    expect(message.type).toBe('text');
    expect(message.text).toBe('請選擇「早餐 80 元」的分類');
    expect(items(message)).toEqual([
      {
        type: 'postback',
        label: '餐飲',
        displayText: '餐飲',
        data: encodePick({ ...pickBase, categoryId: 1 }),
      },
      {
        type: 'postback',
        label: '其他',
        displayText: '其他',
        data: encodePick({ ...pickBase, categoryId: 2 }),
      },
    ]);
  });

  it('每個按鈕的 data 皆可解碼，且除 categoryId 外欄位與原訊息一致、共用同一 token', () => {
    const message = buildCategoryQuickReply({
      ...pickBase,
      ledger: 'company',
      entryType: 'income',
      note: 'A客戶 & B=C',
      categories: [
        { id: 7, name: '營業收入', isFallback: false },
        { id: 8, name: '其他', isFallback: true },
      ],
    });
    const decoded = items(message).map((a) => decodePostback(a.data));
    expect(decoded).toEqual([
      {
        action: 'pick',
        token: 'tokenABC123',
        ledger: 'company',
        entryType: 'income',
        item: '早餐',
        amount: 80,
        date: '2026-11-12',
        note: 'A客戶 & B=C',
        categoryId: 7,
      },
      expect.objectContaining({ categoryId: 8, token: 'tokenABC123', note: 'A客戶 & B=C' }),
    ]);
  });
});

describe('[Edge] Quick Reply 最多 13 個（ASM-06）', () => {
  it('常數：13 / 20', () => {
    expect(MAX_QUICK_REPLY_ITEMS).toBe(13);
    expect(MAX_QUICK_REPLY_LABEL_LENGTH).toBe(20);
  });

  it('剛好 13 個（12 一般 + 其他）→ 全部保留、維持輸入順序', () => {
    const categories = [...regularCategories(12), { id: 13, name: '其他', isFallback: true }];
    const result = items(buildCategoryQuickReply({ ...pickBase, categories }));
    expect(result).toHaveLength(13);
    expect(result.map((a) => a.label)).toEqual(categories.map((c) => c.name));
  });

  it('14 個（13 一般 + 其他）→ 13 個：前 12 個一般分類 + 其他放最後', () => {
    const categories = [...regularCategories(13), { id: 14, name: '其他', isFallback: true }];
    const result = items(buildCategoryQuickReply({ ...pickBase, categories }));
    expect(result).toHaveLength(13);
    expect(result.slice(0, 12).map((a) => a.label)).toEqual(
      regularCategories(12).map((c) => c.name),
    );
    expect(result[12]).toMatchObject({ label: '其他' });
    expect(decodePostback(result[12]?.data ?? '')).toMatchObject({ categoryId: 14 });
    // 第 13 個一般分類（id 13）被捨棄
    expect(result.map((a) => a.label)).not.toContain('分類13');
  });

  it('14 個但「其他」id 落在中間（id 3）→ 仍含其他，且其他排最後、其餘依 id 取前 12', () => {
    const categories = [
      { id: 1, name: '分類1', isFallback: false },
      { id: 2, name: '分類2', isFallback: false },
      { id: 3, name: '其他', isFallback: true },
      ...regularCategories(11, 4), // id 4..14
    ];
    const result = items(buildCategoryQuickReply({ ...pickBase, categories }));
    expect(result).toHaveLength(13);
    expect(result.at(-1)).toMatchObject({ label: '其他' });
    expect(result.slice(0, 12).map((a) => a.label)).toEqual(
      [...regularCategories(2), ...regularCategories(10, 4)].map((c) => c.name),
    );
  });

  it('大量分類（30 個）也只輸出 13 個且含其他', () => {
    const categories = [...regularCategories(29), { id: 30, name: '其他', isFallback: true }];
    const result = items(buildCategoryQuickReply({ ...pickBase, categories }));
    expect(result).toHaveLength(13);
    expect(result.at(-1)).toMatchObject({ label: '其他' });
  });

  it('只有「其他」一個分類 → 1 個按鈕', () => {
    const result = items(
      buildCategoryQuickReply({
        ...pickBase,
        categories: [{ id: 2, name: '其他', isFallback: true }],
      }),
    );
    expect(result).toHaveLength(1);
  });
});

describe('[Edge] Quick Reply label 上限 20 字（ASM-06）', () => {
  const build = (name: string) =>
    items(
      buildCategoryQuickReply({
        ...pickBase,
        categories: [
          { id: 1, name, isFallback: false },
          { id: 2, name: '其他', isFallback: true },
        ],
      }),
    )[0];

  it('剛好 20 字 → 原樣', () => {
    const name = '名'.repeat(20);
    expect(build(name)).toMatchObject({ label: name, displayText: name });
  });

  it('21 字 → label 為前 19 字 + 「…」（總長 20），displayText 保留完整名稱', () => {
    const name = '名'.repeat(21);
    const action = build(name);
    expect(action?.label).toBe(`${'名'.repeat(19)}…`);
    expect(action?.label.length).toBe(20);
    expect(action?.displayText).toBe(name);
  });

  it('極長名稱（200 字）也不超過 20 字', () => {
    const action = build('長'.repeat(200));
    expect(action?.label.length).toBeLessThanOrEqual(20);
    expect(action?.label.endsWith('…')).toBe(true);
  });

  it('截斷不影響 data 中的 categoryId', () => {
    const action = build('名'.repeat(30));
    expect(decodePostback(action?.data ?? '')).toMatchObject({ categoryId: 1 });
  });
});

describe('[Edge] postback data 300 字元上限（ASM-05）', () => {
  const categories = [
    { id: 1, name: '餐飲', isFallback: false },
    { id: 2, name: '其他', isFallback: true },
  ];

  /** 讓 categoryId 最長的那顆按鈕 data 剛好為 targetLength 的備註。 */
  function noteForLength(targetLength: number, maxCategoryId: number): string {
    const base = encodePick({ ...pickBase, note: null, categoryId: maxCategoryId }).length;
    return 'a'.repeat(targetLength - base);
  }

  it('最長按鈕 data 剛好 300 → 正常回 Quick Reply', () => {
    const note = noteForLength(300, 2);
    const message = buildCategoryQuickReply({ ...pickBase, note, categories });
    expect(message.quickReply?.items).toHaveLength(2);
    for (const item of message.quickReply?.items ?? []) {
      expect(item.action.data.length).toBeLessThanOrEqual(300);
    }
  });

  it('最長按鈕 data 301 → 改回純文字「備註太長…」，不含 Quick Reply', () => {
    const note = noteForLength(301, 2);
    const message = buildCategoryQuickReply({ ...pickBase, note, categories });
    expect(message).toEqual({ type: 'text', text: NOTE_TOO_LONG });
    expect(message.quickReply).toBeUndefined();
  });

  it('多位數 categoryId 使 data 多 1 字元：id 9 剛好 300、id 10 為 301 → 整則改回「備註太長」', () => {
    const note = noteForLength(300, 9);
    const fits = buildCategoryQuickReply({
      ...pickBase,
      note,
      categories: [{ id: 9, name: '甲', isFallback: false }],
    });
    expect(fits.quickReply?.items).toHaveLength(1);

    const overflows = buildCategoryQuickReply({
      ...pickBase,
      note,
      categories: [
        { id: 9, name: '甲', isFallback: false },
        { id: 10, name: '乙', isFallback: true },
      ],
    });
    expect(overflows).toEqual({ type: 'text', text: NOTE_TOO_LONG });
  });

  it('備註含需跳脫字元（& = + %）時以跳脫後長度判斷', () => {
    // 100 個 & 跳脫後為 300 字元，加上基底必超過 300
    const message = buildCategoryQuickReply({ ...pickBase, note: '&'.repeat(100), categories });
    expect(message).toEqual({ type: 'text', text: NOTE_TOO_LONG });
  });

  it('中文備註 150 字（URL 編碼會爆量但本專案不編碼中文）→ 仍可回 Quick Reply', () => {
    const message = buildCategoryQuickReply({ ...pickBase, note: '備'.repeat(150), categories });
    expect(message.quickReply?.items).toHaveLength(2);
  });
});

describe('[Edge] 提示文字', () => {
  it('項目含特殊字元時原樣呈現', () => {
    const message = buildCategoryQuickReply({
      ...pickBase,
      item: 'A&B=C+D',
      amount: 1,
      categories: [{ id: 2, name: '其他', isFallback: true }],
    });
    expect(message.text).toBe('請選擇「A&B=C+D 1 元」的分類');
  });

  it('50 字項目 + 最大金額仍產生合法提示（text <= 5000）', () => {
    const message = buildCategoryQuickReply({
      ...pickBase,
      item: '品'.repeat(50),
      amount: 99999999,
      categories: [{ id: 2, name: '其他', isFallback: true }],
    });
    expect(message.text).toBe(`請選擇「${'品'.repeat(50)} 99999999 元」的分類`);
    expect(message.text.length).toBeLessThanOrEqual(5000);
  });
});
