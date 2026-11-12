/**
 * 分類 API 輸入驗證（specs/api/api.yml：listCategories / createCategory / deleteCategory）。
 */
import { z } from 'zod';
import { ENTRY_TYPES, LEDGERS } from '../../domain/enums';

/** 分類名稱上限（categories.name VARCHAR(50)）。 */
export const CATEGORY_NAME_MAX_LENGTH = 50;

export const ListCategoriesQuerySchema = z.object({
  ledger: z.enum(LEDGERS),
  entryType: z.enum(ENTRY_TYPES),
});

export const CreateCategoryBodySchema = z.object({
  ledger: z.enum(LEDGERS),
  entryType: z.enum(ENTRY_TYPES),
  name: z.string().trim().min(1).max(CATEGORY_NAME_MAX_LENGTH),
});

/** path 參數 id：只接受十進位數字字串（範圍由 service 判斷，超出視為不存在）。 */
export const CategoryIdParamSchema = z.object({
  id: z
    .string()
    .regex(/^\d{1,10}$/)
    .transform(Number),
});

export type ListCategoriesQuery = z.infer<typeof ListCategoriesQuerySchema>;
export type CreateCategoryBody = z.infer<typeof CreateCategoryBodySchema>;
