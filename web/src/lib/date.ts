/**
 * 日期工具：一律以 Asia/Taipei 時區計算「今天」與「本月」。
 * 使用 Intl.DateTimeFormat 而非 Date#getXxx，避免執行環境時區（例如 UTC 的 CI）造成誤差。
 */

const TAIPEI_TIME_ZONE = 'Asia/Taipei';

const taipeiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TAIPEI_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 取得指定時間點於 Asia/Taipei 的日期（YYYY-MM-DD）；預設為現在。 */
export function taipeiToday(now: Date = new Date()): string {
  const parts = taipeiDateFormatter.formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** 取得指定時間點於 Asia/Taipei 所屬月份（YYYY-MM）；預設為現在。 */
export function taipeiCurrentMonth(now: Date = new Date()): string {
  return taipeiToday(now).slice(0, 7);
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 是否為合法的 YYYY-MM 月份字串。 */
export function isValidMonth(value: string): boolean {
  return MONTH_PATTERN.test(value);
}

/** 是否為 YYYY-MM-DD 格式的日期字串（日曆合法性交由 <input type="date"> 與後端把關）。 */
export function isDateString(value: string): boolean {
  return DATE_PATTERN.test(value);
}

/** 將 YYYY-MM-DD 轉為列表用的短日期（例如 11/12）。 */
export function formatShortDate(date: string): string {
  const [, month, day] = date.split('-');
  return month && day ? `${Number(month)}/${Number(day)}` : date;
}
