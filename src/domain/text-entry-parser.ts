/**
 * 文字記帳解析器（純函式，無 I/O）：「[公 ][+]項目 金額[ 備註]」與月度摘要指令。
 *
 * 規則（implementation-plan P3-1；specs/features/transaction/以文字訊息記帳.feature）：
 *  1. 先 NFKC 正規化（ASM-01：全形數字 / ＋ / 全形空白轉半形）→ trim → 以 /\s+/ 切詞。
 *  2. 切詞後以單一空白 join 完全等於「本月 / 上月 / 公 本月 / 公 上月」→ summary（優先於記帳）。
 *  3. 首詞為「公」且後面還有詞 → 公司帳本，剝除一次（「公」單獨 → formatError；「公文具」不是前綴）。
 *  4. 下一詞以「+」開頭 → 收入，去掉「+」；去掉後為空 → formatError。
 *  5. 至少「項目、金額」兩詞；金額詞不是數字 → formatError；是數字但非正整數 → amountError；
 *     超過 MAX_AMOUNT → amountTooLarge（ASM-03）。項目（NFKC 後）超過 MAX_ITEM_LENGTH → itemTooLong（ASM-04）。
 *  6. 金額後其餘詞以單一空白 join 為備註；無備註 → null。
 */
import type { EntryType, Ledger } from './enums';

/** 金額上限（ASM-03）。 */
export const MAX_AMOUNT = 99_999_999;
/** 項目最多字數（ASM-04；對應 DB VarChar(50)）。 */
export const MAX_ITEM_LENGTH = 50;

export type SummaryPeriod = 'this_month' | 'last_month';

export type ParseResult =
  | {
      kind: 'entry';
      ledger: Ledger;
      entryType: EntryType;
      item: string;
      amount: number;
      note: string | null;
    }
  | { kind: 'summary'; ledger: Ledger; period: SummaryPeriod }
  | { kind: 'formatError' }
  | { kind: 'amountError' }
  | { kind: 'amountTooLarge' }
  | { kind: 'itemTooLong' };

export type TextEntry = Extract<ParseResult, { kind: 'entry' }>;

const COMPANY_PREFIX = '公';
const INCOME_PREFIX = '+';

const SUMMARY_COMMANDS: ReadonlyMap<string, { ledger: Ledger; period: SummaryPeriod }> = new Map([
  ['本月', { ledger: 'personal', period: 'this_month' }],
  ['上月', { ledger: 'personal', period: 'last_month' }],
  ['公 本月', { ledger: 'company', period: 'this_month' }],
  ['公 上月', { ledger: 'company', period: 'last_month' }],
]);

/** 正整數候選（僅半形數字）。 */
const DIGITS_PATTERN = /^\d+$/;
/** 「看起來是數字」：符合即代表使用者有意輸入金額，只是不是正整數。 */
const NUMERIC_PATTERN = /^[+-]?\d+(\.\d+)?$/;

const FORMAT_ERROR = { kind: 'formatError' } as const;

type AmountResult = { ok: true; amount: number } | { ok: false; error: ParseResult };

/** 解析金額詞（已 NFKC）。以字串長度判斷上限，避免超長數字轉 Number 時溢位。 */
function parseAmount(word: string): AmountResult {
  if (!DIGITS_PATTERN.test(word)) {
    return {
      ok: false,
      error: NUMERIC_PATTERN.test(word) ? { kind: 'amountError' } : FORMAT_ERROR,
    };
  }
  const significant = word.replace(/^0+/, '');
  if (significant === '') return { ok: false, error: { kind: 'amountError' } };
  if (significant.length > String(MAX_AMOUNT).length || Number(significant) > MAX_AMOUNT) {
    return { ok: false, error: { kind: 'amountTooLarge' } };
  }
  return { ok: true, amount: Number(significant) };
}

/** 以 Unicode code point 計算長度（與 PostgreSQL VarChar 字元數一致）。 */
function codePointLength(value: string): number {
  return [...value].length;
}

/**
 * 解析一則 LINE 文字訊息。永不拋出。
 * @param input 原始訊息文字
 */
export function parseTextEntry(input: string): ParseResult {
  const words = input
    .normalize('NFKC')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);

  const summary = SUMMARY_COMMANDS.get(words.join(' '));
  if (summary) return { kind: 'summary', ...summary };

  let ledger: Ledger = 'personal';
  let rest = words;
  if (rest[0] === COMPANY_PREFIX && rest.length > 1) {
    ledger = 'company';
    rest = rest.slice(1);
  }

  const [firstWord, amountWord, ...noteWords] = rest;
  if (firstWord === undefined || amountWord === undefined) return FORMAT_ERROR;

  let entryType: EntryType = 'expense';
  let item = firstWord;
  if (item.startsWith(INCOME_PREFIX)) {
    entryType = 'income';
    item = item.slice(INCOME_PREFIX.length);
    if (item === '') return FORMAT_ERROR;
  }

  const amount = parseAmount(amountWord);
  if (!amount.ok) return amount.error;

  if (codePointLength(item) > MAX_ITEM_LENGTH) return { kind: 'itemTooLong' };

  return {
    kind: 'entry',
    ledger,
    entryType,
    item,
    amount: amount.amount,
    note: noteWords.length > 0 ? noteWords.join(' ') : null,
  };
}
