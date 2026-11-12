/**
 * 資料表主鍵（PostgreSQL int4 autoincrement）的合法範圍判斷（純函式）。
 */

/** PostgreSQL int4 上限（categories.id / transactions.id）。 */
export const MAX_INT4 = 2_147_483_647;

/**
 * 是否為合法的紀錄 id：1..MAX_INT4 的整數。
 * 接受 unknown，讓呼叫端在 id 來源不可信（NaN、Infinity、小數、非 number）時直接視為不存在，
 * 不把不合法值送到 Prisma（否則驗證錯誤會變成「系統忙碌」）。
 */
export function isValidRecordId(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id >= 1 && id <= MAX_INT4;
}
