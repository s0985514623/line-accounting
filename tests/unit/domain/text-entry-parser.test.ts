/**
 * 單元測試：文字記帳解析器（純函式）
 *
 * 執行：npx vitest run tests/unit/domain/text-entry-parser.test.ts
 *
 * 契約（nodejs-master 請遵循）——src/domain/text-entry-parser.ts：
 *   export const MAX_AMOUNT = 99_999_999;          // ASM-03
 *   export const MAX_ITEM_LENGTH = 50;             // ASM-04
 *   export type SummaryPeriod = 'this_month' | 'last_month';
 *   export type ParseResult =
 *     | { kind: 'entry'; ledger: Ledger; entryType: EntryType; item: string; amount: number; note: string | null }
 *     | { kind: 'summary'; ledger: Ledger; period: SummaryPeriod }
 *     | { kind: 'formatError' }       // 無法解析 → 回格式說明
 *     | { kind: 'amountError' }       // 金額非正整數 → 「金額必須為正整數」
 *     | { kind: 'amountTooLarge' }    // 金額 > 99,999,999 → 「金額超過上限」（ASM-03）
 *     | { kind: 'itemTooLong' };      // 項目 > 50 字 → 「項目最多 50 字」（ASM-04）
 *   export function parseTextEntry(input: string): ParseResult;
 *
 * 規則（implementation-plan P3-1；specs/features/transaction/以文字訊息記帳.feature）：
 *   先 NFKC（ASM-01）→ trim → 以 /\s+/ 切詞；
 *   完全等於 本月/上月/公 本月/公 上月 → summary（優先於記帳）；
 *   首詞為「公」且後面還有詞 → company（「公」單獨 → formatError；「公文具」不是前綴）；
 *   下一詞以「+」開頭 → income，去掉「+」，去掉後為空 → formatError；
 *   至少「項目、金額」兩詞；其餘詞以單一空白 join 成備註（無備註 → null）；
 *   項目長度（NFKC 後）> 50 → itemTooLong；金額 > 99,999,999 → amountTooLarge。
 */
import { describe, expect, it } from 'vitest';
import { parseTextEntry } from '../../../src/domain/text-entry-parser';

type Entry = {
  kind: 'entry';
  ledger: 'personal' | 'company';
  entryType: 'expense' | 'income';
  item: string;
  amount: number;
  note: string | null;
  date: null;
};

const entry = (
  ledger: Entry['ledger'],
  entryType: Entry['entryType'],
  item: string,
  amount: number,
  note: string | null = null,
): Entry => ({ kind: 'entry', ledger, entryType, item, amount, note, date: null });

describe('[Smoke] 規格範例（以文字訊息記帳.feature）', () => {
  it.each([
    ['餐飲 120', entry('personal', 'expense', '餐飲', 120)],
    ['公 文具 300', entry('company', 'expense', '文具', 300)],
    ['+薪資 50000', entry('personal', 'income', '薪資', 50000)],
    ['公 +營業收入 30000 A客戶', entry('company', 'income', '營業收入', 30000, 'A客戶')],
    ['餐飲 120 和同事 聚餐', entry('personal', 'expense', '餐飲', 120, '和同事 聚餐')],
  ])('「%s」解析成功', (text, expected) => {
    expect(parseTextEntry(text)).toEqual(expected);
  });
});

describe('[Error] 格式錯誤 → formatError（規格 5 種）', () => {
  it.each(['餐飲', '120', '餐飲 abc', '公', '你好嗎'])('「%s」', (text) => {
    expect(parseTextEntry(text)).toEqual({ kind: 'formatError' });
  });
});

describe('[Error] 金額非正整數 → amountError（規格 3 種）', () => {
  it.each(['餐飲 0', '餐飲 -50', '餐飲 12.5'])('「%s」', (text) => {
    expect(parseTextEntry(text)).toEqual({ kind: 'amountError' });
  });

  it('多個零（00）仍是 0，視為金額錯誤', () => {
    expect(parseTextEntry('餐飲 00')).toEqual({ kind: 'amountError' });
  });

  it('全形負號與全形小數經 NFKC 後同樣視為金額錯誤', () => {
    expect(parseTextEntry('餐飲 －５０')).toEqual({ kind: 'amountError' });
    expect(parseTextEntry('餐飲 １２．５')).toEqual({ kind: 'amountError' });
  });
});

describe('[Edge] NFKC 正規化與空白處理（ASM-01）', () => {
  it('全形加號與全形數字：「＋薪資　５００００」→ 個人收入 50000', () => {
    expect(parseTextEntry('＋薪資　５００００')).toEqual(
      entry('personal', 'income', '薪資', 50000),
    );
  });

  it('全形數字金額：「餐飲　１２０」→ 120', () => {
    expect(parseTextEntry('餐飲　１２０')).toEqual(entry('personal', 'expense', '餐飲', 120));
  });

  it('全形空白（U+3000）作為分隔：「公　文具　３００」', () => {
    expect(parseTextEntry('公　文具　３００')).toEqual(entry('company', 'expense', '文具', 300));
  });

  it('連續多個空白（含全形、半形混用）視為單一分隔', () => {
    expect(parseTextEntry('餐飲    120')).toEqual(entry('personal', 'expense', '餐飲', 120));
    expect(parseTextEntry('餐飲 　 　120')).toEqual(entry('personal', 'expense', '餐飲', 120));
  });

  it('前後空白（含全形空白、換行）會被 trim', () => {
    expect(parseTextEntry('  餐飲 120  ')).toEqual(entry('personal', 'expense', '餐飲', 120));
    expect(parseTextEntry('　餐飲 120　')).toEqual(entry('personal', 'expense', '餐飲', 120));
    expect(parseTextEntry('\n餐飲 120\n')).toEqual(entry('personal', 'expense', '餐飲', 120));
  });

  it('Tab 與換行也是分隔字元（/\\s+/）', () => {
    expect(parseTextEntry('餐飲\t120')).toEqual(entry('personal', 'expense', '餐飲', 120));
    expect(parseTextEntry('餐飲\n120')).toEqual(entry('personal', 'expense', '餐飲', 120));
  });

  it('備註內的連續空白、換行以單一空白 join', () => {
    expect(parseTextEntry('餐飲 120 和同事    聚餐')).toEqual(
      entry('personal', 'expense', '餐飲', 120, '和同事 聚餐'),
    );
    expect(parseTextEntry('餐飲 120 第一行\n第二行')).toEqual(
      entry('personal', 'expense', '餐飲', 120, '第一行 第二行'),
    );
  });

  it('NFKC 會把全形英數轉半形（項目與備註皆然）', () => {
    expect(parseTextEntry('ＫＦＣ １５０ Ａ客戶')).toEqual(
      entry('personal', 'expense', 'KFC', 150, 'A客戶'),
    );
  });

  it('空字串 / 純空白 → formatError', () => {
    expect(parseTextEntry('')).toEqual({ kind: 'formatError' });
    expect(parseTextEntry('   ')).toEqual({ kind: 'formatError' });
    expect(parseTextEntry('　　')).toEqual({ kind: 'formatError' });
  });
});

describe('[Edge] 「公」「+」前綴邊界', () => {
  it('「公」單獨 → formatError', () => {
    expect(parseTextEntry('公')).toEqual({ kind: 'formatError' });
    expect(parseTextEntry(' 公 ')).toEqual({ kind: 'formatError' });
  });

  it('「公 120」：「公」為前綴，剩下只有「120」一詞（缺項目）→ formatError', () => {
    expect(parseTextEntry('公 120')).toEqual({ kind: 'formatError' });
  });

  it('「公文具 300」：「公」未與項目分隔，不是前綴 → 個人帳本、項目「公文具」', () => {
    expect(parseTextEntry('公文具 300')).toEqual(entry('personal', 'expense', '公文具', 300));
  });

  it('「+」單獨 → formatError', () => {
    expect(parseTextEntry('+')).toEqual({ kind: 'formatError' });
  });

  it('「+ 120」：去掉「+」後項目為空 → formatError', () => {
    expect(parseTextEntry('+ 120')).toEqual({ kind: 'formatError' });
  });

  it('「公 +」「公 + 120」→ formatError', () => {
    expect(parseTextEntry('公 +')).toEqual({ kind: 'formatError' });
    expect(parseTextEntry('公 + 120')).toEqual({ kind: 'formatError' });
  });

  it('「+ +薪資 100」：首詞「+」去掉後為空 → formatError（不會往後找項目）', () => {
    expect(parseTextEntry('+ +薪資 100')).toEqual({ kind: 'formatError' });
  });

  it('前綴順序固定為「公」在前、「+」在後', () => {
    expect(parseTextEntry('公 +營業收入 30000')).toEqual(
      entry('company', 'income', '營業收入', 30000),
    );
    // 「+公」= 收入、項目「公」；下一詞「薪資」不是金額 → formatError
    expect(parseTextEntry('+公 薪資 100')).toEqual({ kind: 'formatError' });
  });

  it('「公 公 100」：只剝第一個「公」，項目為「公」', () => {
    expect(parseTextEntry('公 公 100')).toEqual(entry('company', 'expense', '公', 100));
  });

  it('項目中間的「+」保留：「A+B 100」→ 項目「A+B」、支出', () => {
    expect(parseTextEntry('A+B 100')).toEqual(entry('personal', 'expense', 'A+B', 100));
  });
});

describe('[Edge] 備註', () => {
  it('無備註 → note 為 null（不是空字串）', () => {
    expect(parseTextEntry('餐飲 120')).toMatchObject({ note: null });
  });

  it('備註保留 & = + % 等符號與 Emoji（編碼由 postback-codec 負責）', () => {
    expect(parseTextEntry('餐飲 120 a&b=c+d%e 🍜')).toEqual(
      entry('personal', 'expense', '餐飲', 120, 'a&b=c+d%e 🍜'),
    );
  });

  it('備註含看似金額的數字詞也原樣保留', () => {
    expect(parseTextEntry('餐飲 120 另付 50')).toEqual(
      entry('personal', 'expense', '餐飲', 120, '另付 50'),
    );
  });

  it('備註含 XSS / SQL 字串原樣保留（轉義是儲存層責任）', () => {
    const note = "'); DROP TABLE transactions;-- <script>alert(1)</script>";
    expect(parseTextEntry(`餐飲 120 ${note}`)).toEqual(
      entry('personal', 'expense', '餐飲', 120, note),
    );
  });

  it('備註很長（解析層不限制；長度限制由 postback 300 上限處理，ASM-05）', () => {
    const note = '備'.repeat(1000);
    expect(parseTextEntry(`餐飲 120 ${note}`)).toEqual(
      entry('personal', 'expense', '餐飲', 120, note),
    );
  });
});

describe('[Edge] 項目長度上限（ASM-04）', () => {
  it('剛好 50 字 → 成功', () => {
    const item = '品'.repeat(50);
    expect(parseTextEntry(`${item} 100`)).toEqual(entry('personal', 'expense', item, 100));
  });

  it('51 字 → itemTooLong', () => {
    const item = '品'.repeat(51);
    expect(parseTextEntry(`${item} 100`)).toEqual({ kind: 'itemTooLong' });
  });

  it('帶前綴時長度仍只計項目：「公 +」+ 50 字成功、51 字失敗', () => {
    expect(parseTextEntry(`公 +${'品'.repeat(50)} 100`)).toMatchObject({
      kind: 'entry',
      ledger: 'company',
      entryType: 'income',
    });
    expect(parseTextEntry(`公 +${'品'.repeat(51)} 100`)).toEqual({ kind: 'itemTooLong' });
  });

  it('長度以 NFKC 正規化「之後」計算（「㈱」正規化為 3 字元「(株)」：16 個 = 48 字成功、17 個 = 51 字失敗）', () => {
    expect(parseTextEntry(`${'㈱'.repeat(16)} 100`)).toMatchObject({ kind: 'entry' });
    expect(parseTextEntry(`${'㈱'.repeat(17)} 100`)).toEqual({ kind: 'itemTooLong' });
  });
});

describe('[Edge] 金額上限（ASM-03）', () => {
  it('99999999 → 成功（上限含）', () => {
    expect(parseTextEntry('餐飲 99999999')).toEqual(entry('personal', 'expense', '餐飲', 99999999));
  });

  it('100000000 → amountTooLarge', () => {
    expect(parseTextEntry('餐飲 100000000')).toEqual({ kind: 'amountTooLarge' });
  });

  it('超過 Number 安全整數的超長數字 → amountTooLarge（不得溢位成錯誤的數字）', () => {
    expect(parseTextEntry(`餐飲 ${'9'.repeat(30)}`)).toEqual({ kind: 'amountTooLarge' });
  });

  it('全形 １００００００００ 同樣 → amountTooLarge', () => {
    expect(parseTextEntry('餐飲 １００００００００')).toEqual({ kind: 'amountTooLarge' });
  });

  it('金額 1（最小合法值）', () => {
    expect(parseTextEntry('餐飲 1')).toEqual(entry('personal', 'expense', '餐飲', 1));
  });
});

describe('[Edge] 摘要指令（優先於記帳）', () => {
  it.each([
    ['本月', 'personal', 'this_month'],
    ['上月', 'personal', 'last_month'],
    ['公 本月', 'company', 'this_month'],
    ['公 上月', 'company', 'last_month'],
  ] as const)('「%s」→ summary', (text, ledger, period) => {
    expect(parseTextEntry(text)).toEqual({ kind: 'summary', ledger, period });
  });

  it('前後空白、全形空白、多空白不影響（「 本月 」「公　本月」「公   上月」）', () => {
    expect(parseTextEntry(' 本月 ')).toEqual({
      kind: 'summary',
      ledger: 'personal',
      period: 'this_month',
    });
    expect(parseTextEntry('公　本月')).toEqual({
      kind: 'summary',
      ledger: 'company',
      period: 'this_month',
    });
    expect(parseTextEntry('公   上月')).toEqual({
      kind: 'summary',
      ledger: 'company',
      period: 'last_month',
    });
    expect(parseTextEntry('　上月　')).toEqual({
      kind: 'summary',
      ledger: 'personal',
      period: 'last_month',
    });
  });

  it('「本月 100」不是摘要指令（非完全相等）→ 項目「本月」的記帳', () => {
    expect(parseTextEntry('本月 100')).toEqual(entry('personal', 'expense', '本月', 100));
    expect(parseTextEntry('公 本月 100')).toEqual(entry('company', 'expense', '本月', 100));
  });

  it('「本月份」「本月 上月」不是摘要指令 → formatError', () => {
    expect(parseTextEntry('本月份')).toEqual({ kind: 'formatError' });
    expect(parseTextEntry('本月 上月')).toEqual({ kind: 'formatError' });
  });

  it('「+本月」「公 +上月」不是摘要指令 → formatError', () => {
    expect(parseTextEntry('+本月')).toEqual({ kind: 'formatError' });
    expect(parseTextEntry('公 +上月')).toEqual({ kind: 'formatError' });
  });
});

describe('[Security] 惡意 / 奇異輸入', () => {
  it.each([
    ["'; DROP TABLE transactions;-- 100"],
    ['<script>alert(1)</script> 100'],
    ['🍜 120'],
    ['\u202Eevil 100'],
    ['餐飲 120\u0000'],
    ['a'.repeat(10_000)],
    ['餐飲 ' + '9'.repeat(10_000)],
  ])('輸入「%s」不拋例外，只回傳合法的 ParseResult', (text) => {
    const result = parseTextEntry(text);
    expect([
      'entry',
      'summary',
      'formatError',
      'amountError',
      'amountTooLarge',
      'itemTooLong',
    ]).toContain(result.kind);
  });

  it('SQL / HTML 字串作為項目原樣保留（不跳脫、不截斷）', () => {
    expect(parseTextEntry("x';DROP-- 100")).toEqual(entry('personal', 'expense', "x';DROP--", 100));
    expect(parseTextEntry('<b>粗</b> 100')).toEqual(entry('personal', 'expense', '<b>粗</b>', 100));
  });

  it('Emoji 項目（BMP 外字元）可解析', () => {
    expect(parseTextEntry('🍜 120')).toEqual(entry('personal', 'expense', '🍜', 120));
  });
});
