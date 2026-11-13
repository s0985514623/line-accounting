/**
 * 每月固定收支的到期日計算（純函式，無 I/O）。日期一律為 'YYYY-MM-DD'（Asia/Taipei）。
 *
 *  - 每月 dayOfMonth 號到期；當月沒有該日（29/30/31）→ 改用當月最後一天。
 *  - 第一次到期日：本月到期日不早於今天 → 本月；否則下個月。
 *  - 下一次到期日：以「上一次到期日所在月份」的下個月計算（不受 2 月月底調整影響，3 月仍回到 31 號）。
 */

/** dayOfMonth 合法範圍。 */
export const MIN_DAY_OF_MONTH = 1;
export const MAX_DAY_OF_MONTH = 31;

/** 推播時間：Asia/Taipei 這個小時（含）之後才推播當天到期的固定收支。 */
export const RECURRING_NOTIFY_HOUR = 9;

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

/** 指定年月的到期日（超過當月天數時改為最後一天）。month 為 1–12。 */
export function dueDateInMonth(year: number, month: number, dayOfMonth: number): string {
  const day = Math.min(dayOfMonth, daysInMonth(year, month));
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function yearMonthOf(date: string): { year: number; month: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

function addMonths(
  { year, month }: { year: number; month: number },
  count: number,
): { year: number; month: number } {
  const index = year * 12 + (month - 1) + count;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/**
 * 從 from（含）起算的第一個到期日。
 * @param from 'YYYY-MM-DD'，通常為今天
 */
export function firstDueOnOrAfter(dayOfMonth: number, from: string): string {
  const current = yearMonthOf(from);
  const thisMonth = dueDateInMonth(current.year, current.month, dayOfMonth);
  if (thisMonth >= from) return thisMonth;
  const next = addMonths(current, 1);
  return dueDateInMonth(next.year, next.month, dayOfMonth);
}

/** dueOn 的下一期到期日（下個月）。 */
export function nextDueOn(dueOn: string, dayOfMonth: number): string {
  const next = addMonths(yearMonthOf(dueOn), 1);
  return dueDateInMonth(next.year, next.month, dayOfMonth);
}

/** 'YYYY-MM-DD' 所在月份 'YYYY-MM'。 */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** 指定時刻在 Asia/Taipei 的小時（0–23）。 */
export function hourInTaipei(now: Date): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(now);
  return Number(hour);
}
