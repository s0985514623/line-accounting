/**
 * API 回應 / 請求的 zod schema 與型別；形狀以 specs/api/api.yml 為唯一依據。
 */
import { z } from 'zod';

export const LEDGERS = ['personal', 'company'] as const;
export const ENTRY_TYPES = ['expense', 'income'] as const;

export const VIOLATION_TYPES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'CATEGORY_MISMATCH',
  'DUPLICATE_NAME',
  'FALLBACK_CATEGORY_UNDELETABLE',
] as const;

export const ledgerSchema = z.enum(LEDGERS);
export const entryTypeSchema = z.enum(ENTRY_TYPES);
export const violationTypeSchema = z.enum(VIOLATION_TYPES);

export type TLedger = z.infer<typeof ledgerSchema>;
export type TEntryType = z.infer<typeof entryTypeSchema>;
export type TViolationType = z.infer<typeof violationTypeSchema>;

/** 錯誤回應：{ message, violationType }（message 僅供除錯，不顯示給使用者）。 */
export const errorBodySchema = z.object({
  message: z.string(),
  violationType: violationTypeSchema,
});

export const transactionSchema = z.object({
  id: z.number().int(),
  ledger: ledgerSchema,
  entryType: entryTypeSchema,
  item: z.string(),
  amount: z.number().int(),
  categoryId: z.number().int(),
  categoryName: z.string(),
  occurredOn: z.string(),
  note: z.string().nullable(),
  source: z.enum(['line_text', 'liff_form']),
});

export type TTransaction = z.infer<typeof transactionSchema>;

export const transactionListSchema = z.object({
  items: z.array(transactionSchema),
});

/** POST / PUT /api/transactions 的 body（全欄位）。 */
export type TTransactionInput = {
  ledger: TLedger;
  entryType: TEntryType;
  item: string;
  amount: number;
  categoryId: number;
  occurredOn: string;
  note: string | null;
};

export const categorySchema = z.object({
  id: z.number().int(),
  ledger: ledgerSchema,
  entryType: entryTypeSchema,
  name: z.string(),
  isFallback: z.boolean(),
});

export type TCategory = z.infer<typeof categorySchema>;

export const categoryListSchema = z.object({
  items: z.array(categorySchema),
});
