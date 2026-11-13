/**
 * LIFF 批次記帳表單的值、前端驗證與送出 payload 轉換（純函式，與 UI 無關）。
 * 帳本、收支整批共用；每列各自有項目、金額、分類、日期、備註。
 * 項目與金額都空白的列視為空白列，送出時略過。
 */
import type { TEntryType, TLedger, TTransactionInput } from '../api/schemas';
import {
  toTransactionInput,
  validateFormValues,
  type TTransactionFormErrors,
} from './transaction-form';

/** 一次最多筆數（與後端 TRANSACTION_BATCH_MAX_ITEMS 一致）。 */
export const BATCH_MAX_ROWS = 50;

export type TBatchRow = {
  /** React key（前端產生，不送出） */
  key: number;
  item: string;
  amount: string;
  categoryId: string;
  occurredOn: string;
  note: string;
};

export type TBatchRowField = Exclude<keyof TBatchRow, 'key'>;
export type TBatchRowErrors = Pick<
  TTransactionFormErrors,
  'item' | 'amount' | 'categoryId' | 'occurredOn'
>;

export const BATCH_MESSAGES = {
  NO_ROWS: '請至少填寫一筆',
  TOO_MANY_ROWS: `一次最多 ${BATCH_MAX_ROWS} 筆`,
} as const;

let nextKey = 1;

export function createEmptyRow(occurredOn: string): TBatchRow {
  return { key: nextKey++, item: '', amount: '', categoryId: '', occurredOn, note: '' };
}

/** 項目與金額都空白 → 空白列（略過，不驗證）。 */
export function isBlankRow(row: TBatchRow): boolean {
  return row.item.trim() === '' && row.amount.trim() === '';
}

function toFormValues(ledger: TLedger, entryType: TEntryType, row: TBatchRow) {
  return {
    ledger,
    entryType,
    item: row.item,
    amount: row.amount,
    categoryId: row.categoryId,
    occurredOn: row.occurredOn,
    note: row.note,
  };
}

export type TBatchValidation = {
  /** 以 row.key 為索引；沒有錯誤的列不出現 */
  rowErrors: Record<number, TBatchRowErrors>;
  /** 整批層級的錯誤（沒有任何列、超過上限） */
  formError: string | undefined;
};

export function validateBatch(
  ledger: TLedger,
  entryType: TEntryType,
  rows: readonly TBatchRow[],
): TBatchValidation {
  const filled = rows.filter((row) => !isBlankRow(row));
  const rowErrors: Record<number, TBatchRowErrors> = {};
  for (const row of filled) {
    const errors = validateFormValues(toFormValues(ledger, entryType, row));
    if (Object.keys(errors).length > 0) rowErrors[row.key] = errors;
  }
  let formError: string | undefined;
  if (filled.length === 0) formError = BATCH_MESSAGES.NO_ROWS;
  else if (filled.length > BATCH_MAX_ROWS) formError = BATCH_MESSAGES.TOO_MANY_ROWS;
  return { rowErrors, formError };
}

export function hasBatchErrors(validation: TBatchValidation): boolean {
  return validation.formError !== undefined || Object.keys(validation.rowErrors).length > 0;
}

/** 非空白列依畫面順序轉為 API body。 */
export function toBatchInputs(
  ledger: TLedger,
  entryType: TEntryType,
  rows: readonly TBatchRow[],
): TTransactionInput[] {
  return rows
    .filter((row) => !isBlankRow(row))
    .map((row) => toTransactionInput(toFormValues(ledger, entryType, row)));
}
