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

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 年月（month 為 1–12）。 */
export interface YearMonth {
  year: number;
  month: number;
}

/** 嚴格解析 'YYYY-MM'（月份 01–12）；其餘格式（含前後空白、全形數字、'2026-1'）回 null。 */
export function parseMonth(value: string): YearMonth | null {
  const match = MONTH_PATTERN.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** 解析 'YYYY-MM'，不合法時拋 RangeError。 */
function requireMonth(value: string): YearMonth {
  const parsed = parseMonth(value);
  if (!parsed) {
    throw new RangeError(`月份格式必須為 YYYY-MM：${JSON.stringify(value)}`);
  }
  return parsed;
}

function formatMonth({ year, month }: YearMonth): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** 下一個月（12 月 → 隔年 1 月）。 */
function nextYearMonth({ year, month }: YearMonth): YearMonth {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/**
 * 'YYYY-MM' 的前一個月（'2026-01' → '2025-12'）。
 * @throws RangeError 月份格式不合法
 */
export function previousMonth(month: string): string {
  const { year, month: m } = requireMonth(month);
  return formatMonth(m === 1 ? { year: year - 1, month: 12 } : { year, month: m - 1 });
}

/** 月份的半開日期區間 [start, endExclusive)，皆為 'YYYY-MM-DD'。 */
export interface MonthRange {
  start: string;
  endExclusive: string;
}

/**
 * 月份的半開區間：start = 當月 1 日、endExclusive = 下個月 1 日。
 * @throws RangeError 月份格式不合法
 */
export function monthRange(month: string): MonthRange {
  const parsed = requireMonth(month);
  return {
    start: `${formatMonth(parsed)}-01`,
    endExclusive: `${formatMonth(nextYearMonth(parsed))}-01`,
  };
}

/** 月度摘要的期間指令。 */
export type SummaryPeriod = 'this_month' | 'last_month';

/** 以 Asia/Taipei 的「今天」決定摘要月份：this_month = 今天所在月；last_month = 其前一個月。 */
export function resolveSummaryMonth(period: SummaryPeriod, now: Date): string {
  const thisMonth = todayInTaipei(now).slice(0, 7);
  return period === 'this_month' ? thisMonth : previousMonth(thisMonth);
}
