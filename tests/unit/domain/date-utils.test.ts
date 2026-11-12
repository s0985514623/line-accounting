/**
 * 單元測試：日期工具（純函式，無 I/O）
 *
 * 執行：npx vitest run tests/unit/domain/date-utils.test.ts
 *
 * 契約（nodejs-master 請遵循；皆為 src/domain/date-utils.ts 的 export）：
 *   既有：todayInTaipei(now: Date): string、isValidDateOnly(value: string): boolean
 *   P5 新增：
 *     parseMonth(value: string): { year: number; month: number } | null
 *       // 嚴格 'YYYY-MM'（月份 01–12）；其餘（'2026-13'、'2026-1'、'2026-11-01'、含空白…）回 null
 *     previousMonth(month: string): string
 *       // 'YYYY-MM' → 前一個月（'2026-01' → '2025-12'）；不合法拋 RangeError
 *     monthRange(month: string): { start: string; endExclusive: string }
 *       // 半開區間 [start, endExclusive)，皆為 'YYYY-MM-DD'；endExclusive = 下個月 1 日；不合法拋 RangeError
 *     resolveSummaryMonth(period: 'this_month' | 'last_month', now: Date): string
 *       // 以 Asia/Taipei 的「今天」決定月份：this_month = 今天所在月；last_month = previousMonth(本月)
 *       // （本函式為測試工程師為「時區邊界」補的組合入口；handler 不必自行拼 todayInTaipei + previousMonth）
 * 依據：specs/features/report/查詢月度文字摘要.feature（月份以 Asia/Taipei 計算；跨年）；
 *       implementation-plan P5-1；test-strategy §5。
 */
import { describe, expect, it } from 'vitest';
import {
  isValidDateOnly,
  monthRange,
  parseMonth,
  previousMonth,
  resolveSummaryMonth,
  todayInTaipei,
} from '../../../src/domain/date-utils';

describe('[Smoke] 月份工具：規格範例', () => {
  it('2026-11 → 上月 2026-10、區間 [2026-11-01, 2026-12-01)', () => {
    expect(parseMonth('2026-11')).toEqual({ year: 2026, month: 11 });
    expect(previousMonth('2026-11')).toBe('2026-10');
    expect(monthRange('2026-11')).toEqual({ start: '2026-11-01', endExclusive: '2026-12-01' });
  });

  it('今天 2026-01-05 → 本月 2026-01、上月 2025-12（跨年）', () => {
    const now = new Date('2026-01-05T04:00:00.000Z');
    expect(resolveSummaryMonth('this_month', now)).toBe('2026-01');
    expect(resolveSummaryMonth('last_month', now)).toBe('2025-12');
  });
});

describe('[Happy] previousMonth', () => {
  it.each([
    ['2026-11', '2026-10'],
    ['2026-03', '2026-02'],
    ['2026-12', '2026-11'],
    ['2000-01', '1999-12'],
  ])('%s → %s', (input, expected) => {
    expect(previousMonth(input)).toBe(expected);
  });
});

describe('[Edge] previousMonth：跨年', () => {
  it('2026-01 → 2025-12（前一年十二月，補零格式）', () => {
    expect(previousMonth('2026-01')).toBe('2025-12');
  });

  it('2026-10 → 2026-09（個位數月份補零）', () => {
    expect(previousMonth('2026-10')).toBe('2026-09');
  });
});

describe('[Happy] monthRange：半開區間', () => {
  it.each([
    ['2026-11', '2026-11-01', '2026-12-01'],
    ['2026-01', '2026-01-01', '2026-02-01'],
    ['2026-09', '2026-09-01', '2026-10-01'],
  ])('%s → [%s, %s)', (month, start, endExclusive) => {
    expect(monthRange(month)).toEqual({ start, endExclusive });
  });
});

describe('[Edge] monthRange：跨年與閏年', () => {
  it('2026-12 → 結束為隔年 2027-01-01', () => {
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01', endExclusive: '2027-01-01' });
  });

  it('二月（平年 / 閏年）的結束一律為 3 月 1 日（不需要知道天數）', () => {
    expect(monthRange('2026-02').endExclusive).toBe('2026-03-01');
    expect(monthRange('2028-02').endExclusive).toBe('2028-03-01');
  });

  it('區間為半開：月底最後一天在內、下月 1 日不在內（字串比較即可）', () => {
    const { start, endExclusive } = monthRange('2026-10');
    const inRange = (d: string) => d >= start && d < endExclusive;
    expect(inRange('2026-10-01')).toBe(true);
    expect(inRange('2026-10-31')).toBe(true); // 規格：宵夜 2026-10-31 屬於上月
    expect(inRange('2026-11-01')).toBe(false);
    expect(inRange('2026-09-30')).toBe(false);
  });
});

describe('[Error] parseMonth / previousMonth / monthRange：不合法月份', () => {
  const invalid = [
    '',
    '2026',
    '2026-1',
    '2026-00',
    '2026-13',
    '202611',
    '2026/11',
    '2026-11-01',
    ' 2026-11',
    '2026-11 ',
    '26-11',
    'abcd-ef',
    '2026-１１', // 全形數字
  ];

  it.each(invalid)('parseMonth(%j) → null', (value) => {
    expect(parseMonth(value)).toBeNull();
  });

  it.each(invalid)('previousMonth(%j) 拋 RangeError', (value) => {
    expect(() => previousMonth(value)).toThrow(RangeError);
  });

  it.each(invalid)('monthRange(%j) 拋 RangeError', (value) => {
    expect(() => monthRange(value)).toThrow(RangeError);
  });
});

describe('[Edge] todayInTaipei / resolveSummaryMonth：Asia/Taipei 時區邊界（UTC+8）', () => {
  it('UTC 15:59:59 仍是台北同一天；16:00:00 進入台北隔天', () => {
    expect(todayInTaipei(new Date('2026-11-12T15:59:59.999Z'))).toBe('2026-11-12');
    expect(todayInTaipei(new Date('2026-11-12T16:00:00.000Z'))).toBe('2026-11-13');
  });

  it('UTC 年底 2025-12-31T16:00:00Z → 台北 2026-01-01', () => {
    expect(todayInTaipei(new Date('2025-12-31T15:59:59.999Z'))).toBe('2025-12-31');
    expect(todayInTaipei(new Date('2025-12-31T16:00:00.000Z'))).toBe('2026-01-01');
  });

  it('閏日：UTC 2028-02-28T16:00Z → 台北 2028-02-29', () => {
    expect(todayInTaipei(new Date('2028-02-28T16:00:00.000Z'))).toBe('2028-02-29');
  });

  it('月底跨月：UTC 2026-10-31T16:00:00Z → 台北已是 11 月，本月 2026-11、上月 2026-10', () => {
    const now = new Date('2026-10-31T16:00:00.000Z');
    expect(resolveSummaryMonth('this_month', now)).toBe('2026-11');
    expect(resolveSummaryMonth('last_month', now)).toBe('2026-10');
  });

  it('月底跨月：UTC 2026-10-31T15:59:59Z → 台北仍是 10 月，本月 2026-10、上月 2026-09', () => {
    const now = new Date('2026-10-31T15:59:59.000Z');
    expect(resolveSummaryMonth('this_month', now)).toBe('2026-10');
    expect(resolveSummaryMonth('last_month', now)).toBe('2026-09');
  });

  it('跨年邊界：UTC 2025-12-31T16:00:00Z → 本月 2026-01、上月 2025-12', () => {
    const now = new Date('2025-12-31T16:00:00.000Z');
    expect(resolveSummaryMonth('this_month', now)).toBe('2026-01');
    expect(resolveSummaryMonth('last_month', now)).toBe('2025-12');
  });

  it('跨年邊界：UTC 2025-12-31T15:59:59Z → 本月 2025-12、上月 2025-11', () => {
    const now = new Date('2025-12-31T15:59:59.000Z');
    expect(resolveSummaryMonth('this_month', now)).toBe('2025-12');
    expect(resolveSummaryMonth('last_month', now)).toBe('2025-11');
  });
});

describe('isValidDateOnly（既有行為的特徵測試）', () => {
  it.each(['2026-11-12', '2028-02-29', '2000-02-29', '2026-12-31', '2026-01-01'])(
    '合法：%s',
    (value) => {
      expect(isValidDateOnly(value)).toBe(true);
    },
  );

  it.each([
    '2026-02-30',
    '2026-02-29', // 2026 非閏年
    '2100-02-29', // 世紀年非閏年
    '2026-13-01',
    '2026-00-10',
    '2026-11-00',
    '2026-11-31',
    '2026-1-1',
    '2026-11-12T00:00:00Z',
    ' 2026-11-12',
    '',
    '２０２６-11-12', // 全形數字
  ])('不合法：%j', (value) => {
    expect(isValidDateOnly(value)).toBe(false);
  });
});
