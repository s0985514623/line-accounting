/**
 * 編輯頁的 router state：列表頁以 navigate/Link state 帶入整筆紀錄作為預填來源
 * （api.yml 沒有單筆 GET）。直接開網址時沒有 state，必須能安全判定為「找不到」。
 * returnTo：進入編輯頁前的頁面（含 query，例如 `/?month=2026-05&ledger=personal`），
 * 儲存或返回時回到原本的月份 / 帳本，而不是重設成本月。
 */
import { z } from 'zod';
import { transactionSchema, type TTransaction } from '../api/schemas';

export type TEditRouteState = {
  transaction: TTransaction;
  /** 儲存 / 返回後要回到的站內路徑（以 / 開頭） */
  returnTo?: string;
};

const editRouteStateSchema = z.object({ transaction: transactionSchema });

/** 只接受站內路徑（/ 開頭、不是 // 或 /\ 開頭），避免被導到外部網址。 */
function isInternalPath(value: unknown): value is string {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value);
}

/** 建立編輯頁的 router state。 */
export function createEditRouteState(
  transaction: TTransaction,
  returnTo?: string,
): TEditRouteState {
  return returnTo === undefined ? { transaction } : { transaction, returnTo };
}

/**
 * 從 location.state 取出返回路徑；沒有或不合法時回傳 '/'。
 * @param state location.state（unknown）
 */
export function readReturnTo(state: unknown): string {
  const returnTo =
    typeof state === 'object' && state !== null
      ? (state as Record<string, unknown>).returnTo
      : undefined;
  return isInternalPath(returnTo) ? returnTo : '/';
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
