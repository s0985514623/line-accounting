/**
 * 記帳表單的值、前端驗證與送出 payload 轉換（純函式，與 UI 無關）。
 */
import type { TEntryType, TLedger, TTransaction, TTransactionInput } from '../api/schemas';
import { isDateString } from './date';

/** 項目上限（ASM-04；與後端相同以字串 length 計算）。 */
export const ITEM_MAX_LENGTH = 50;
/** 金額上限（ASM-03）。 */
export const AMOUNT_MAX = 99_999_999;

/** 表單欄位值；數字欄位保留原始字串，送出時才轉換。 */
export type TTransactionFormValues = {
  ledger: TLedger;
  entryType: TEntryType;
  item: string;
  amount: string;
  categoryId: string;
  occurredOn: string;
  note: string;
};

export type TTransactionFormField = keyof TTransactionFormValues;
export type TTransactionFormErrors = Partial<Record<TTransactionFormField, string>>;

export const VALIDATION_MESSAGES = {
  ITEM_REQUIRED: '請輸入項目',
  ITEM_TOO_LONG: '項目最多 50 個字',
  AMOUNT_INVALID: '請輸入大於 0 的整數金額',
  AMOUNT_TOO_LARGE: '金額不可超過 99,999,999',
  CATEGORY_REQUIRED: '請選擇分類',
  DATE_REQUIRED: '請選擇日期',
} as const;

/** 新增模式的預設值：個人／支出、日期為今天（由呼叫端傳入 Asia/Taipei 的今天）。 */
export function createEmptyFormValues(today: string): TTransactionFormValues {
  return {
    ledger: 'personal',
    entryType: 'expense',
    item: '',
    amount: '',
    categoryId: '',
    occurredOn: today,
    note: '',
  };
}

/** 編輯模式的預填值。 */
export function toFormValues(transaction: TTransaction): TTransactionFormValues {
  return {
    ledger: transaction.ledger,
    entryType: transaction.entryType,
    item: transaction.item,
    amount: String(transaction.amount),
    categoryId: String(transaction.categoryId),
    occurredOn: transaction.occurredOn,
    note: transaction.note ?? '',
  };
}

const POSITIVE_INTEGER_PATTERN = /^\d+$/;

function validateAmount(amount: string): string | undefined {
  const trimmed = amount.trim();
  if (!POSITIVE_INTEGER_PATTERN.test(trimmed) || Number(trimmed) < 1) {
    return VALIDATION_MESSAGES.AMOUNT_INVALID;
  }
  if (Number(trimmed) > AMOUNT_MAX) return VALIDATION_MESSAGES.AMOUNT_TOO_LARGE;
  return undefined;
}

/** 前端驗證；回傳空物件代表通過。 */
export function validateFormValues(values: TTransactionFormValues): TTransactionFormErrors {
  const errors: TTransactionFormErrors = {};
  const item = values.item.trim();
  if (item === '') errors.item = VALIDATION_MESSAGES.ITEM_REQUIRED;
  else if (item.length > ITEM_MAX_LENGTH) errors.item = VALIDATION_MESSAGES.ITEM_TOO_LONG;

  const amountError = validateAmount(values.amount);
  if (amountError) errors.amount = amountError;

  if (values.categoryId === '') errors.categoryId = VALIDATION_MESSAGES.CATEGORY_REQUIRED;
  if (!isDateString(values.occurredOn)) errors.occurredOn = VALIDATION_MESSAGES.DATE_REQUIRED;
  return errors;
}

/** 轉為 API body：item trim、數字轉 number、備註空字串 → null；其餘原樣送出（不轉義）。 */
export function toTransactionInput(values: TTransactionFormValues): TTransactionInput {
  return {
    ledger: values.ledger,
    entryType: values.entryType,
    item: values.item.trim(),
    amount: Number(values.amount.trim()),
    categoryId: Number(values.categoryId),
    occurredOn: values.occurredOn,
    note: values.note === '' ? null : values.note,
  };
}
