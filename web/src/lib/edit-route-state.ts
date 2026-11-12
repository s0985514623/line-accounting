/**
 * 編輯頁的 router state：列表頁以 navigate/Link state 帶入整筆紀錄作為預填來源
 * （api.yml 沒有單筆 GET）。直接開網址時沒有 state，必須能安全判定為「找不到」。
 */
import { z } from 'zod';
import { transactionSchema, type TTransaction } from '../api/schemas';

export type TEditRouteState = {
  transaction: TTransaction;
};

const editRouteStateSchema = z.object({ transaction: transactionSchema });

/** 建立編輯頁的 router state。 */
export function createEditRouteState(transaction: TTransaction): TEditRouteState {
  return { transaction };
}

/**
 * 從 location.state 取出要編輯的紀錄；state 缺漏、格式不符或 id 與路徑不一致時回傳 null。
 * @param state location.state（unknown）
 * @param routeId 路徑參數 :id
 */
export function readEditRouteState(state: unknown, routeId: string): TTransaction | null {
  const parsed = editRouteStateSchema.safeParse(state);
  if (!parsed.success) return null;
  return String(parsed.data.transaction.id) === routeId ? parsed.data.transaction : null;
}
