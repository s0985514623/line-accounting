/**
 * 文字記帳解析器（純函式，無 I/O）：「[公 ][+]項目 金額[ 備註]」與月度摘要指令。
 *
 * 規則（implementation-plan P3-1；specs/features/transaction/以文字訊息記帳.feature）：
 *  1. 先 NFKC 正規化（ASM-01：全形數字 / ＋ / 全形空白轉半形）→ trim → 以 /\s+/ 切詞。
 *  2. 切詞後以單一空白 join 完全等於「本月 / 上月 / 公 本月 / 公 上月」→ summary（優先於記帳）。
 *  3. 首詞為「公」且後面還有詞 → 公司帳本，剝除一次（「公」單獨 → formatError；「公文具」不是前綴）。
 *     日期前綴（今天 / 昨天 / 前天 / M/D / YYYY/M/D / YYYY-M-D）可放在「公」之前或之後，
 *     且只有在後面還剩「項目、金額」兩詞以上時才視為日期（「11/10 120」仍是項目 11/10）。
 *     月 / 日超出範圍 → dateError；日曆合法性與「不可晚於今天」由 resolveEntryDate 判斷。
 *  4. 下一詞以「+」開頭 → 收入，去掉「+」；去掉後為空 → formatError。
 *  5. 至少「項目、金額」兩詞；金額詞不是數字 → formatError；是數字但非正整數 → amountError；
 *     超過 MAX_AMOUNT → amountTooLarge（ASM-03）。項目（NFKC 後）超過 MAX_ITEM_LENGTH → itemTooLong（ASM-04）。
 *  6. 金額後其餘詞以單一空白 join 為備註；無備註 → null。
 */
import type { EntryDateSpec, SummaryPeriod } from './date-utils';
import type { EntryType, Ledger } from './enums';

export type { EntryDateSpec, SummaryPeriod } from './date-utils';

/** 金額上限（ASM-03）。 */
export const MAX_AMOUNT = 99_999_999;
/** 項目最多字數（ASM-04；對應 DB VarChar(50)）。 */
export const MAX_ITEM_LENGTH = 50;

export type ParseResult =
  | {
      kind: 'entry';
      ledger: Ledger;
      entryType: EntryType;
      item: string;
      amount: number;
      note: string | null;
      /** 日期前綴；null = 今天 */
      date: EntryDateSpec | null;
    }
  | { kind: 'summary'; ledger: Ledger; period: SummaryPeriod }
  /** 「待分類」：重新顯示最早一筆待分類的批次項目 */
  | { kind: 'resumePending' }
  /** 「固定」：列出每月固定收支 */
  | { kind: 'listRecurring' }
  | { kind: 'formatError' }
  | { kind: 'dateError' }
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

const RESUME_PENDING_COMMAND = '待分類';
const LIST_RECURRING_COMMAND = '固定';

const RELATIVE_DATE_WORDS: ReadonlyMap<string, number> = new Map([
  ['今天', 0],
  ['昨天', 1],
  ['前天', 2],
]);

const FULL_DATE_PATTERN = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/;
const MONTH_DAY_PATTERN = /^(\d{1,2})\/(\d{1,2})$/;

type DateWordResult = { ok: true; spec: EntryDateSpec } | { ok: false; error: ParseResult } | null;

/** 判斷一個詞是否為日期前綴；不是日期 → null；像日期但月 / 日超出範圍 → dateError。 */
function parseDateWord(word: string): DateWordResult {
  const daysAgo = RELATIVE_DATE_WORDS.get(word);
  if (daysAgo !== undefined) return { ok: true, spec: { kind: 'relative', daysAgo } };

  const full = FULL_DATE_PATTERN.exec(word);
  const monthDay = full ? null : MONTH_DAY_PATTERN.exec(word);
  if (!full && !monthDay) return null;

  const year = full ? Number(full[1]) : null;
  const month = Number(full ? full[2] : monthDay?.[1]);
  const day = Number(full ? full[3] : monthDay?.[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { ok: false, error: { kind: 'dateError' } };
  }
  return { ok: true, spec: { kind: 'calendar', year, month, day } };
}

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

  const joined = words.join(' ');
  const summary = SUMMARY_COMMANDS.get(joined);
  if (summary) return { kind: 'summary', ...summary };
  if (joined === RESUME_PENDING_COMMAND) return { kind: 'resumePending' };
  if (joined === LIST_RECURRING_COMMAND) return { kind: 'listRecurring' };

  let ledger: Ledger = 'personal';
  let date: EntryDateSpec | null = null;
  let rest = words;
  // 「公」與日期前綴順序不拘，各最多剝除一次
  for (let round = 0; round < 2; round += 1) {
    if (ledger === 'personal' && rest[0] === COMPANY_PREFIX && rest.length > 1) {
      ledger = 'company';
      rest = rest.slice(1);
      continue;
    }
    if (date === null && rest.length >= 3 && rest[0] !== undefined) {
      const parsedDate = parseDateWord(rest[0]);
      if (parsedDate && !parsedDate.ok) return parsedDate.error;
      if (parsedDate) {
        date = parsedDate.spec;
        rest = rest.slice(1);
        continue;
      }
    }
    break;
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
    date,
  };
}
