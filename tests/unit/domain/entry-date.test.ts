/**
 * 單元測試：文字記帳的日期前綴（解析 + 換算）與批次分類按鈕 codec。
 *
 * 執行：npx vitest run tests/unit/domain/entry-date.test.ts
 */
import { describe, expect, it } from 'vitest';
import { resolveEntryDate, subtractDays } from '../../../src/domain/date-utils';
import { decodePostback, encodeBatchPick } from '../../../src/domain/postback-codec';
import { parseTextEntry } from '../../../src/domain/text-entry-parser';

describe('parseTextEntry 日期前綴', () => {
  it.each([
    ['今天 午餐 120', { kind: 'relative', daysAgo: 0 }],
    ['昨天 午餐 120', { kind: 'relative', daysAgo: 1 }],
    ['前天 午餐 120', { kind: 'relative', daysAgo: 2 }],
    ['11/10 午餐 120', { kind: 'calendar', year: null, month: 11, day: 10 }],
    ['2025/1/2 午餐 120', { kind: 'calendar', year: 2025, month: 1, day: 2 }],
    ['2025-01-02 午餐 120', { kind: 'calendar', year: 2025, month: 1, day: 2 }],
    ['１１／１０ 午餐 １２０', { kind: 'calendar', year: null, month: 11, day: 10 }],
  ])('「%s」', (text, date) => {
    expect(parseTextEntry(text)).toMatchObject({ kind: 'entry', item: '午餐', date });
  });

  it('「公」與日期順序不拘', () => {
    const expected = { kind: 'entry', ledger: 'company', item: '文具', date: { daysAgo: 1 } };
    expect(parseTextEntry('公 昨天 文具 300')).toMatchObject(expected);
    expect(parseTextEntry('昨天 公 文具 300')).toMatchObject(expected);
  });

  it('日期後只剩一詞 → 不是日期，當成項目', () => {
    expect(parseTextEntry('11/10 120')).toMatchObject({ item: '11/10', amount: 120, date: null });
    expect(parseTextEntry('昨天 120')).toMatchObject({ item: '昨天', date: null });
  });

  it('只剝一個日期前綴', () => {
    expect(parseTextEntry('昨天 前天 120')).toMatchObject({ item: '前天', date: { daysAgo: 1 } });
  });

  it.each(['13/1 午餐 120', '0/1 午餐 120', '1/32 午餐 120', '1/0 午餐 120'])(
    '「%s」月日超出範圍 → dateError',
    (text) => {
      expect(parseTextEntry(text)).toEqual({ kind: 'dateError' });
    },
  );

  it('日期樣式但非前綴位置 → 正常解析（日期留在備註）', () => {
    expect(parseTextEntry('午餐 120 11/10')).toMatchObject({ note: '11/10', date: null });
  });

  it('「待分類」→ resumePending；「待分類 1」不是指令', () => {
    expect(parseTextEntry('待分類')).toEqual({ kind: 'resumePending' });
    expect(parseTextEntry('待分類 1')).toMatchObject({ kind: 'entry', item: '待分類' });
  });
});

describe('resolveEntryDate', () => {
  const today = '2026-03-01';

  it('null → 今天；相對日期跨月', () => {
    expect(resolveEntryDate(null, today)).toEqual({ ok: true, date: today });
    expect(resolveEntryDate({ kind: 'relative', daysAgo: 1 }, today)).toEqual({
      ok: true,
      date: '2026-02-28',
    });
  });

  it('無年份且今年該日晚於今天 → 去年', () => {
    expect(resolveEntryDate({ kind: 'calendar', year: null, month: 12, day: 31 }, today)).toEqual({
      ok: true,
      date: '2025-12-31',
    });
    expect(resolveEntryDate({ kind: 'calendar', year: null, month: 3, day: 1 }, today)).toEqual({
      ok: true,
      date: '2026-03-01',
    });
  });

  it('不存在的日期 → invalid；晚於今天 → future', () => {
    expect(resolveEntryDate({ kind: 'calendar', year: 2025, month: 2, day: 29 }, today)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(resolveEntryDate({ kind: 'calendar', year: 2026, month: 3, day: 2 }, today)).toEqual({
      ok: false,
      reason: 'future',
    });
  });

  it('閏年 2/29（無年份）落在去年不存在時 → invalid', () => {
    // 今天 2026-01-10：2/29 → 2026-02-29 晚於今天 → 改 2025-02-29 → 不存在
    expect(
      resolveEntryDate({ kind: 'calendar', year: null, month: 2, day: 29 }, '2026-01-10'),
    ).toEqual({ ok: false, reason: 'invalid' });
    expect(
      resolveEntryDate({ kind: 'calendar', year: null, month: 2, day: 29 }, '2028-03-01'),
    ).toEqual({ ok: true, date: '2028-02-29' });
  });

  it('subtractDays 跨年', () => {
    expect(subtractDays('2026-01-01', 2)).toBe('2025-12-30');
  });
});

describe('bpick postback codec', () => {
  it('round trip', () => {
    const data = encodeBatchPick({ pendingId: 12, categoryId: 3 });
    expect(data).toBe('action=bpick&id=12&categoryId=3');
    expect(decodePostback(data)).toEqual({ action: 'bpick', pendingId: 12, categoryId: 3 });
  });

  it.each([
    'action=bpick&id=0&categoryId=3',
    'action=bpick&id=1',
    'action=bpick&id=1&categoryId=3&x=1',
    'action=bpick&id=01&categoryId=3',
    'action=bpick&id=2147483648&categoryId=3',
  ])('不合法 → null：%s', (data) => {
    expect(decodePostback(data)).toBeNull();
  });
});
