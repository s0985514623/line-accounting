/**
 * 記帳 API 輸入驗證（specs/api/api.yml：listTransactions / createTransaction / updateTransaction /
 * deleteTransaction；implementation-plan P7-1、ASM-03、ASM-04）。
 * 驗證失敗由路由層經 parseInput 轉成 INVALID_ARGUMENT（400）。
 */
import { z } from 'zod';
import { isValidDateOnly } from '../../domain/date-utils';
import { EntryTypeSchema, LedgerSchema, MonthSchema, RecordIdParamSchema } from './common';

/** 項目上限（transactions.item VARCHAR(50)；ASM-04）。 */
export const TRANSACTION_ITEM_MAX_LENGTH = 50;
/** 金額上限（ASM-03）。 */
export const TRANSACTION_AMOUNT_MAX = 99_999_999;

/** 'YYYY-MM-DD' 且日曆上存在（2026-02-30 失敗）；不 trim、不 coerce。 */
const DateOnlySchema = z
  .string()
  .refine(isValidDateOnly, { message: '日期必須為合法的 YYYY-MM-DD' });

/** 備註：可省略 / null / 字串；空字串視為無備註（null）。 */
const NoteSchema = z
  .string()
  .nullish()
  .transform((note) => (note ? note : null));

/** POST /api/transactions 與 PUT /api/transactions/{id} 的 body（全欄位）。 */
export const TransactionInputSchema = z.object({
  ledger: LedgerSchema,
  entryType: EntryTypeSchema,
  item: z.string().trim().min(1).max(TRANSACTION_ITEM_MAX_LENGTH),
  amount: z.number().int().min(1).max(TRANSACTION_AMOUNT_MAX),
  categoryId: z.number().int(),
  occurredOn: DateOnlySchema,
  note: NoteSchema,
});

/** GET /api/transactions 的 query：month、ledger 皆必填。 */
export const ListTransactionsQuerySchema = z.object({
  month: MonthSchema,
  ledger: LedgerSchema,
});

/** /api/transactions/{id} 的 path 參數。 */
export const TransactionIdParamSchema = RecordIdParamSchema;

export type TransactionInput = z.infer<typeof TransactionInputSchema>;
export type ListTransactionsQuery = z.infer<typeof ListTransactionsQuerySchema>;
