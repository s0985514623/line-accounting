/**
 * 分類 API 與對應的 TanStack Query hooks。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './http';
import {
  categoryListSchema,
  categorySchema,
  type TCategory,
  type TCategoryInput,
  type TEntryType,
  type TLedger,
} from './schemas';
import { TRANSACTIONS_QUERY_KEY } from './transactions';

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

/** 新增分類；body 原樣送出（trim 由頁面負責）。 */
export function createCategory(input: TCategoryInput): Promise<TCategory> {
  return request('/api/categories', { method: 'POST', body: input, schema: categorySchema });
}

/** 刪除分類；其底下紀錄由伺服器改歸同帳本同收支的「其他」。 */
export function deleteCategory(id: number): Promise<void> {
  return request(`/api/categories/${id}`, { method: 'DELETE' });
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

/**
 * 新增分類的 Hook；成功後讓分類查詢失效以重新載入。
 * 失效後的重新載入不阻塞 mutation 完成（頁面可立即清空輸入框）。
 */
export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY });
    },
  });
}

/** 刪除分類的 Hook；成功後讓分類與記帳列表查詢失效（舊紀錄已改歸「其他」）。 */
export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: TRANSACTIONS_QUERY_KEY });
    },
  });
}
