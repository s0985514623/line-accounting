/**
 * 記帳紀錄 API 與對應的 TanStack Query hooks。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './http';
import {
  transactionListSchema,
  transactionSchema,
  type TLedger,
  type TTransaction,
  type TTransactionInput,
} from './schemas';

/** 所有記帳列表查詢共用的 query key 前綴（invalidate 用）。 */
export const TRANSACTIONS_QUERY_KEY = ['transactions'] as const;

export async function fetchTransactions(month: string, ledger: TLedger): Promise<TTransaction[]> {
  const { items } = await request('/api/transactions', {
    query: { month, ledger },
    schema: transactionListSchema,
  });
  return items;
}

export function createTransaction(input: TTransactionInput): Promise<TTransaction> {
  return request('/api/transactions', { method: 'POST', body: input, schema: transactionSchema });
}

export async function createTransactionsBatch(
  inputs: TTransactionInput[],
): Promise<TTransaction[]> {
  const { items } = await request('/api/transactions/batch', {
    method: 'POST',
    body: { items: inputs },
    schema: transactionListSchema,
  });
  return items;
}

export function updateTransaction(id: number, input: TTransactionInput): Promise<TTransaction> {
  return request(`/api/transactions/${id}`, {
    method: 'PUT',
    body: input,
    schema: transactionSchema,
  });
}

export function deleteTransaction(id: number): Promise<void> {
  return request(`/api/transactions/${id}`, { method: 'DELETE' });
}

/**
 * 取得指定月份、帳本的記帳列表（順序依 API 回傳，前端不重排）。
 * @param month YYYY-MM
 * @param ledger 帳本
 */
export function useTransactions(month: string, ledger: TLedger) {
  return useQuery({
    queryKey: [...TRANSACTIONS_QUERY_KEY, month, ledger],
    queryFn: () => fetchTransactions(month, ledger),
  });
}

/** 刪除記帳紀錄；成功後讓所有列表查詢失效以重新載入。 */
export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTransaction,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TRANSACTIONS_QUERY_KEY }),
  });
}

/**
 * 儲存記帳紀錄：有 id 為編輯（PUT），否則新增（POST）；成功後讓列表查詢失效。
 * @param id 編輯中的紀錄 id（新增時為 undefined）
 */
export function useSaveTransaction(id: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TTransactionInput) =>
      id === undefined ? createTransaction(input) : updateTransaction(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TRANSACTIONS_QUERY_KEY }),
  });
}

/** 批次新增記帳紀錄（全部成功或全部不寫入）；成功後讓列表查詢失效。 */
export function useCreateTransactionsBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTransactionsBatch,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TRANSACTIONS_QUERY_KEY }),
  });
}
