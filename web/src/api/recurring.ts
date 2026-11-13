/**
 * 每月固定收支 API 與對應的 TanStack Query hooks。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './http';
import {
  recurringEntryListSchema,
  recurringEntrySchema,
  recurringOccurrenceListSchema,
  transactionSchema,
  type TRecurringEntry,
  type TRecurringEntryInput,
  type TRecurringOccurrence,
  type TTransaction,
} from './schemas';
import { TRANSACTIONS_QUERY_KEY } from './transactions';

export const RECURRING_QUERY_KEY = ['recurring'] as const;
const ENTRIES_QUERY_KEY = [...RECURRING_QUERY_KEY, 'entries'] as const;
const OCCURRENCES_QUERY_KEY = [...RECURRING_QUERY_KEY, 'occurrences'] as const;

export async function fetchRecurringEntries(): Promise<TRecurringEntry[]> {
  const { items } = await request('/api/recurring', { schema: recurringEntryListSchema });
  return items;
}

export async function fetchPendingOccurrences(): Promise<TRecurringOccurrence[]> {
  const { items } = await request('/api/recurring/occurrences', {
    schema: recurringOccurrenceListSchema,
  });
  return items;
}

export function saveRecurringEntry(
  id: number | undefined,
  input: TRecurringEntryInput,
): Promise<TRecurringEntry> {
  return id === undefined
    ? request('/api/recurring', { method: 'POST', body: input, schema: recurringEntrySchema })
    : request(`/api/recurring/${id}`, {
        method: 'PUT',
        body: input,
        schema: recurringEntrySchema,
      });
}

export function deleteRecurringEntry(id: number): Promise<void> {
  return request(`/api/recurring/${id}`, { method: 'DELETE' });
}

/** 確認入帳；amount 省略 = 本期金額。 */
export function confirmOccurrence(id: number, amount?: number): Promise<TTransaction> {
  return request(`/api/recurring/occurrences/${id}/confirm`, {
    method: 'POST',
    body: amount === undefined ? {} : { amount },
    schema: transactionSchema,
  });
}

export function skipOccurrence(id: number): Promise<void> {
  return request(`/api/recurring/occurrences/${id}/skip`, { method: 'POST' });
}

export function useRecurringEntries() {
  return useQuery({ queryKey: ENTRIES_QUERY_KEY, queryFn: fetchRecurringEntries });
}

export function usePendingOccurrences() {
  return useQuery({ queryKey: OCCURRENCES_QUERY_KEY, queryFn: fetchPendingOccurrences });
}

/** 新增（id 為 undefined）或編輯規則；成功後讓固定收支查詢失效。 */
export function useSaveRecurringEntry(id: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TRecurringEntryInput) => saveRecurringEntry(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RECURRING_QUERY_KEY }),
  });
}

/** 切換啟用 / 停用（以全欄位 PUT）。 */
export function useToggleRecurringEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entry: TRecurringEntry) =>
      saveRecurringEntry(entry.id, {
        ledger: entry.ledger,
        entryType: entry.entryType,
        item: entry.item,
        amount: entry.amount,
        categoryId: entry.categoryId,
        dayOfMonth: entry.dayOfMonth,
        note: entry.note,
        active: !entry.active,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RECURRING_QUERY_KEY }),
  });
}

export function useDeleteRecurringEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteRecurringEntry,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RECURRING_QUERY_KEY }),
  });
}

/** 確認入帳 / 略過；成功後固定收支與記帳列表都重新載入。 */
export function useResolveOccurrence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: number; action: 'confirm' | 'skip'; amount?: number }) =>
      args.action === 'confirm'
        ? confirmOccurrence(args.id, args.amount).then(() => undefined)
        : skipOccurrence(args.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: RECURRING_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: TRANSACTIONS_QUERY_KEY }),
      ]);
    },
  });
}
