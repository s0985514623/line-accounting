/**
 * 每月固定收支 API 輸入驗證（specs/api/api.yml：recurring*）。
 * 驗證失敗由路由層經 parseInput 轉成 INVALID_ARGUMENT（400）。
 */
import { z } from 'zod';
import { MAX_DAY_OF_MONTH, MIN_DAY_OF_MONTH } from '../../domain/recurring-schedule';
import { EntryTypeSchema, LedgerSchema, RecordIdParamSchema } from './common';
import { TRANSACTION_AMOUNT_MAX, TRANSACTION_ITEM_MAX_LENGTH } from './transaction';

const AmountSchema = z.number().int().min(1).max(TRANSACTION_AMOUNT_MAX);

/** POST /api/recurring 與 PUT /api/recurring/{id} 的 body（全欄位）。 */
export const RecurringEntryInputSchema = z.object({
  ledger: LedgerSchema,
  entryType: EntryTypeSchema,
  item: z.string().trim().min(1).max(TRANSACTION_ITEM_MAX_LENGTH),
  amount: AmountSchema,
  categoryId: z.number().int(),
  dayOfMonth: z.number().int().min(MIN_DAY_OF_MONTH).max(MAX_DAY_OF_MONTH),
  note: z
    .string()
    .nullish()
    .transform((note) => (note ? note : null)),
  /** 省略 = 啟用 */
  active: z.boolean().default(true),
});

/** POST /api/recurring/occurrences/{id}/confirm 的 body（amount 省略 = 本期金額）。 */
export const ConfirmOccurrenceInputSchema = z.object({ amount: AmountSchema.optional() });

export const RecurringIdParamSchema = RecordIdParamSchema;
