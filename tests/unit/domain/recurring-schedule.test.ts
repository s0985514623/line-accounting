import { describe, expect, it } from 'vitest';
import {
  dueDateInMonth,
  firstDueOnOrAfter,
  hourInTaipei,
  nextDueOn,
} from '../../../src/domain/recurring-schedule';

describe('dueDateInMonth', () => {
  it('一般日期原樣回傳', () => {
    expect(dueDateInMonth(2026, 11, 5)).toBe('2026-11-05');
  });

  it('31 號遇到 30 天的月份 → 30 號', () => {
    expect(dueDateInMonth(2026, 11, 31)).toBe('2026-11-30');
  });

  it('2 月：平年 28、閏年 29', () => {
    expect(dueDateInMonth(2027, 2, 31)).toBe('2027-02-28');
    expect(dueDateInMonth(2028, 2, 30)).toBe('2028-02-29');
  });
});

describe('firstDueOnOrAfter', () => {
  it('本月到期日還沒到 → 本月', () => {
    expect(firstDueOnOrAfter(20, '2026-11-13')).toBe('2026-11-20');
  });

  it('今天就是到期日 → 今天', () => {
    expect(firstDueOnOrAfter(13, '2026-11-13')).toBe('2026-11-13');
  });

  it('本月到期日已過 → 下個月', () => {
    expect(firstDueOnOrAfter(5, '2026-11-13')).toBe('2026-12-05');
  });

  it('12 月已過 → 隔年 1 月', () => {
    expect(firstDueOnOrAfter(5, '2026-12-13')).toBe('2027-01-05');
  });

  it('月底調整：11 月 31 號 → 11/30', () => {
    expect(firstDueOnOrAfter(31, '2026-11-13')).toBe('2026-11-30');
  });
});

describe('nextDueOn', () => {
  it('下個月同一天', () => {
    expect(nextDueOn('2026-11-05', 5)).toBe('2026-12-05');
  });

  it('跨年', () => {
    expect(nextDueOn('2026-12-05', 5)).toBe('2027-01-05');
  });

  it('2 月月底調整後，3 月回到 31 號', () => {
    expect(nextDueOn('2027-01-31', 31)).toBe('2027-02-28');
    expect(nextDueOn('2027-02-28', 31)).toBe('2027-03-31');
  });
});

describe('hourInTaipei', () => {
  it('UTC 01:00 = 台北 09:00', () => {
    expect(hourInTaipei(new Date('2026-11-13T01:00:00Z'))).toBe(9);
  });

  it('UTC 16:30 = 台北隔天 00 點', () => {
    expect(hourInTaipei(new Date('2026-11-13T16:30:00Z'))).toBe(0);
  });
});
