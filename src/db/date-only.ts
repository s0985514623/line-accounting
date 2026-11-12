/**
 * 'YYYY-MM-DD' ↔ Date（UTC 午夜）轉換，只在 repository 邊界使用（implementation-plan R11）。
 * Prisma `@db.Date` 在 JS 端為 UTC 午夜的 Date；全專案其餘部分以日期字串流通。
 */

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 將 'YYYY-MM-DD' 轉為該日 UTC 00:00:00.000。
 * 格式錯誤或日曆上不存在的日期（如 2026-02-30）一律拋錯，不進位成其他日期。
 */
export function parseDateOnly(value: string): Date {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    throw new RangeError(`日期格式必須為 YYYY-MM-DD：${value}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(0);
  // setUTCFullYear 不會把 0–99 年解讀為 1900 年代（Date.UTC 會）
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`日期不存在：${value}`);
  }
  return date;
}

/** 以 UTC 欄位將 Date 格式化為 'YYYY-MM-DD'；Invalid Date 拋錯。 */
export function formatDateOnly(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('無效的 Date');
  }
  return date.toISOString().slice(0, 10);
}
