/**
 * 日期工具（純函式，無 I/O）。全專案日期以 'YYYY-MM-DD' 字串流通（implementation-plan R11）；
 * 「今天」一律以 Asia/Taipei 換算。
 */

export const APP_TIME_ZONE = 'Asia/Taipei';

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const TAIPEI_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 指定時刻在 Asia/Taipei 的日期（YYYY-MM-DD）。 */
export function todayInTaipei(now: Date): string {
  return TAIPEI_DATE_FORMAT.format(now);
}

/** 是否為格式正確且日曆上存在的 'YYYY-MM-DD'（2026-02-30、2026-13-01 皆為 false）。 */
export function isValidDateOnly(value: string): boolean {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
