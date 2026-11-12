/**
 * 領域列舉與中文標籤對照（純資料，無 I/O）。
 * 值與 specs/entity/erm.dbml、specs/api/api.yml 的 enum 一致。
 */

export const LEDGERS = ['personal', 'company'] as const;
export type Ledger = (typeof LEDGERS)[number];

export const ENTRY_TYPES = ['expense', 'income'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const ENTRY_SOURCES = ['line_text', 'liff_form'] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const LEDGER_LABELS: Readonly<Record<Ledger, string>> = {
  personal: '個人',
  company: '公司',
};

export const ENTRY_TYPE_LABELS: Readonly<Record<EntryType, string>> = {
  expense: '支出',
  income: '收入',
};

export const ENTRY_SOURCE_LABELS: Readonly<Record<EntrySource, string>> = {
  line_text: 'LINE文字',
  liff_form: 'LIFF表單',
};

/** 型別守衛：字串是否為合法帳本值。 */
export function isLedger(value: unknown): value is Ledger {
  return typeof value === 'string' && (LEDGERS as readonly string[]).includes(value);
}

/** 型別守衛：字串是否為合法收支值。 */
export function isEntryType(value: unknown): value is EntryType {
  return typeof value === 'string' && (ENTRY_TYPES as readonly string[]).includes(value);
}
