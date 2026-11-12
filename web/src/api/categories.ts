/**
 * 分類 API 與對應的 TanStack Query hooks。
 */
import { useQuery } from '@tanstack/react-query';
import { request } from './http';
import { categoryListSchema, type TCategory, type TEntryType, type TLedger } from './schemas';

export const CATEGORIES_QUERY_KEY = ['categories'] as const;

/** 取得指定帳本 × 收支的分類（順序依 API：一般分類在前、「其他」在後）。 */
export async function fetchCategories(
  ledger: TLedger,
  entryType: TEntryType,
): Promise<TCategory[]> {
  const { items } = await request('/api/categories', {
    query: { ledger, entryType },
    schema: categoryListSchema,
  });
  return items;
}

/**
 * 取得分類清單的 Hook。
 * @param ledger 帳本
 * @param entryType 收支
 */
export function useCategories(ledger: TLedger, entryType: TEntryType) {
  return useQuery({
    queryKey: [...CATEGORIES_QUERY_KEY, ledger, entryType],
    queryFn: () => fetchCategories(ledger, entryType),
  });
}
