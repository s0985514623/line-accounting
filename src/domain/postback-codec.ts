/**
 * LINE postback data 編解碼（純函式，無 I/O）。
 *
 * 編碼規則（implementation-plan R4）：
 *  - 格式為 `key=value&key=value`；只跳脫 `% & = +`（→ %25 %26 %3D %2B），中文、Emoji、空白保留原字，
 *    以免 URL 百分比編碼讓中文膨脹到每字 9 字元而超過 LINE 的 300 字元上限（ASM-05）。
 *  - pick 欄位順序固定：action, token, ledger, type, item, amount, date, note, categoryId
 *    （與 specs/features/transaction/選擇分類完成記帳.feature 的範例逐字一致）；note 為 null 編成 `note=`。
 *  - delete：`action=delete&id=<id>`；delete_confirm / delete_cancel：`action=delete_confirm&id=<id>`、
 *    `action=delete_cancel&id=<id>`（請求刪除記帳紀錄.feature、確認刪除記帳紀錄.feature）。
 * 解碼：任何不合法（未知 action、缺欄位、多餘 / 重複欄位、值不合法）一律回 null，永不拋出（ASM-07）。
 */
import { z } from 'zod';
import { isValidDateOnly } from './date-utils';
import { ENTRY_TYPES, LEDGERS, type EntryType, type Ledger } from './enums';
import { MAX_INT4 } from './record-id';
import { MAX_AMOUNT, MAX_ITEM_LENGTH } from './text-entry-parser';

/** LINE postback action data 上限（以字串 .length 計）。 */
export const POSTBACK_DATA_MAX_LENGTH = 300;

/** 一次性分類按鈕 token 的最大長度（對應 postback_tokens.token VarChar(64)）。 */
const MAX_TOKEN_LENGTH = 64;

export interface PickPayload {
  token: string;
  ledger: Ledger;
  entryType: EntryType;
  item: string;
  amount: number;
  /** YYYY-MM-DD */
  date: string;
  note: string | null;
  categoryId: number;
}

/** 以紀錄 id 為唯一欄位的刪除流程 action。 */
export const RECORD_ACTIONS = ['delete', 'delete_confirm', 'delete_cancel'] as const;
export type RecordAction = (typeof RECORD_ACTIONS)[number];

export type PostbackPayload =
  ({ action: 'pick' } & PickPayload) | { action: RecordAction; id: number };

export function isPostbackDataWithinLimit(data: string): boolean {
  return data.length <= POSTBACK_DATA_MAX_LENGTH;
}

// ---- 編碼 ------------------------------------------------------------------------------------

const ESCAPES: Readonly<Record<string, string>> = {
  '%': '%25',
  '&': '%26',
  '=': '%3D',
  '+': '%2B',
};

const UNESCAPES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ESCAPES).map(([raw, escaped]) => [escaped, raw]),
);

function escapeValue(value: string): string {
  return value.replace(/[%&=+]/g, (char) => ESCAPES[char] ?? char);
}

function unescapeValue(value: string): string {
  // 單次左到右掃描：`%2541` → `%41`，不會被二次解碼
  return value.replace(/%(?:25|26|3D|2B)/gi, (seq) => UNESCAPES[seq.toUpperCase()] ?? seq);
}

function encodePairs(pairs: ReadonlyArray<readonly [string, string]>): string {
  return pairs.map(([key, value]) => `${key}=${escapeValue(value)}`).join('&');
}

/** 編碼分類按鈕 data。永不拋出；超長與否由呼叫端以 isPostbackDataWithinLimit 判斷。 */
export function encodePick(payload: PickPayload): string {
  return encodePairs([
    ['action', 'pick'],
    ['token', payload.token],
    ['ledger', payload.ledger],
    ['type', payload.entryType],
    ['item', payload.item],
    ['amount', String(payload.amount)],
    ['date', payload.date],
    ['note', payload.note ?? ''],
    ['categoryId', String(payload.categoryId)],
  ]);
}

function encodeRecordAction(action: RecordAction, id: number): string {
  return encodePairs([
    ['action', action],
    ['id', String(id)],
  ]);
}

/** 編碼「刪除」按鈕 data。 */
export function encodeDelete(id: number): string {
  return encodeRecordAction('delete', id);
}

/** 編碼刪除確認提示的「確定」按鈕 data。 */
export function encodeConfirm(id: number): string {
  return encodeRecordAction('delete_confirm', id);
}

/** 編碼刪除確認提示的「取消」按鈕 data。 */
export function encodeCancel(id: number): string {
  return encodeRecordAction('delete_cancel', id);
}

// ---- 解碼 ------------------------------------------------------------------------------------

/** 正整數字串（不允許前導 0、正負號、小數），且不超過 max。 */
function positiveIntString(max: number) {
  return z
    .string()
    .regex(/^[1-9]\d*$/)
    .refine((value) => value.length <= String(max).length && Number(value) <= max)
    .transform(Number);
}

const PickSchema = z
  .strictObject({
    action: z.literal('pick'),
    token: z
      .string()
      .min(1)
      .max(MAX_TOKEN_LENGTH)
      .regex(/^[A-Za-z0-9_-]+$/),
    ledger: z.enum(LEDGERS),
    type: z.enum(ENTRY_TYPES),
    item: z
      .string()
      .min(1)
      .refine((value) => [...value].length <= MAX_ITEM_LENGTH),
    amount: positiveIntString(MAX_AMOUNT),
    date: z.string().refine(isValidDateOnly),
    note: z.string(),
    categoryId: positiveIntString(MAX_INT4),
  })
  .transform((raw): PostbackPayload => ({
    action: 'pick',
    token: raw.token,
    ledger: raw.ledger,
    entryType: raw.type,
    item: raw.item,
    amount: raw.amount,
    date: raw.date,
    note: raw.note === '' ? null : raw.note,
    categoryId: raw.categoryId,
  }));

function recordActionSchema(action: RecordAction): z.ZodType<PostbackPayload> {
  return z
    .strictObject({
      action: z.literal(action),
      id: positiveIntString(MAX_INT4),
    })
    .transform((raw): PostbackPayload => ({ action, id: raw.id }));
}

const SCHEMAS_BY_ACTION: ReadonlyMap<string, z.ZodType<PostbackPayload>> = new Map<
  string,
  z.ZodType<PostbackPayload>
>([
  ['pick', PickSchema],
  ...RECORD_ACTIONS.map((action) => [action, recordActionSchema(action)] as const),
]);

/** 切成 key → value（已反跳脫）；格式錯誤或 key 重複回 null。以 Map 承接，避免 `__proto__` 之類的 key 汙染物件。 */
function splitPairs(data: string): Map<string, string> | null {
  if (data.length === 0) return null;
  const fields = new Map<string, string>();
  for (const pair of data.split('&')) {
    const separator = pair.indexOf('=');
    if (separator <= 0) return null;
    const key = pair.slice(0, separator);
    if (fields.has(key)) return null;
    fields.set(key, unescapeValue(pair.slice(separator + 1)));
  }
  return fields;
}

/** 解碼 postback data；不合法一律回 null（永不拋出）。 */
export function decodePostback(data: string): PostbackPayload | null {
  const fields = splitPairs(data);
  const schema = fields ? SCHEMAS_BY_ACTION.get(fields.get('action') ?? '') : undefined;
  if (!fields || !schema) return null;
  const result = schema.safeParse(Object.fromEntries(fields));
  return result.success ? result.data : null;
}
