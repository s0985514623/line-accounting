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
  'OCCURRENCE_RESOLVED',
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

/** 月度統計的單一分類（ratio 為百分比，分母為同收支合計，四捨五入至小數一位）。 */
export const expenseByCategorySchema = z.object({
  /** 舊版伺服器回應沒有此欄位；缺少時以分類名稱比對細項 */
  categoryId: z.number().int().optional(),
  categoryName: z.string(),
  amount: z.number().int(),
  ratio: z.number(),
});

export const monthlyReportSchema = z.object({
  ledger: ledgerSchema,
  month: z.string(),
  incomeTotal: z.number().int(),
  expenseTotal: z.number().int(),
  balance: z.number().int(),
  expenseByCategory: z.array(expenseByCategorySchema),
  // 新增欄位：缺少時視為無收入分類（相容舊版伺服器回應）
  incomeByCategory: z.array(expenseByCategorySchema).default([]),
});

export type TExpenseByCategory = z.infer<typeof expenseByCategorySchema>;
export type TCategoryShare = TExpenseByCategory;
export type TMonthlyReport = z.infer<typeof monthlyReportSchema>;

/** POST /api/categories 的 body。 */
export type TCategoryInput = {
  ledger: TLedger;
  entryType: TEntryType;
  name: string;
};

/** 每月固定收支規則。 */
export const recurringEntrySchema = z.object({
  id: z.number().int(),
  ledger: ledgerSchema,
  entryType: entryTypeSchema,
  item: z.string(),
  amount: z.number().int(),
  categoryId: z.number().int(),
  categoryName: z.string(),
  /** 每月幾號（1–31；當月沒有該日時為最後一天） */
  dayOfMonth: z.number().int(),
  note: z.string().nullable(),
  active: z.boolean(),
  /** 下一次到期日 YYYY-MM-DD */
  nextDueOn: z.string(),
});

export type TRecurringEntry = z.infer<typeof recurringEntrySchema>;

export const recurringEntryListSchema = z.object({
  items: z.array(recurringEntrySchema),
});

/** POST / PUT /api/recurring 的 body（全欄位）。 */
export type TRecurringEntryInput = {
  ledger: TLedger;
  entryType: TEntryType;
  item: string;
  amount: number;
  categoryId: number;
  dayOfMonth: number;
  note: string | null;
  active: boolean;
};

/** 待確認的一期固定收支。 */
export const recurringOccurrenceSchema = z.object({
  id: z.number().int(),
  recurringEntryId: z.number().int(),
  ledger: ledgerSchema,
  entryType: entryTypeSchema,
  item: z.string(),
  amount: z.number().int(),
  categoryId: z.number().int(),
  categoryName: z.string(),
  note: z.string().nullable(),
  /** 到期日 YYYY-MM-DD */
  dueOn: z.string(),
});

export type TRecurringOccurrence = z.infer<typeof recurringOccurrenceSchema>;

export const recurringOccurrenceListSchema = z.object({
  items: z.array(recurringOccurrenceSchema),
});

/** 年度報表的單月合計。 */
export const monthTotalsSchema = z.object({
  /** YYYY-MM */
  month: z.string(),
  incomeTotal: z.number().int(),
  expenseTotal: z.number().int(),
  balance: z.number().int(),
});

export type TMonthTotals = z.infer<typeof monthTotalsSchema>;

/** 年度報表：全年合計、分類佔比與 1–12 月收支。 */
export const annualReportSchema = z.object({
  ledger: ledgerSchema,
  year: z.number().int(),
  incomeTotal: z.number().int(),
  expenseTotal: z.number().int(),
  balance: z.number().int(),
  expenseByCategory: z.array(expenseByCategorySchema),
  incomeByCategory: z.array(expenseByCategorySchema),
  months: z.array(monthTotalsSchema),
});

export type TAnnualReport = z.infer<typeof annualReportSchema>;
