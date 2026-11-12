/**
 * 單元測試：日期字串 ↔ Date（UTC 午夜）轉換（src/db/date-only.ts）
 *
 * 執行：npx vitest run tests/unit/db/date-only.test.ts    （或 npm run test:unit）
 *
 * 契約：
 *   - parseDateOnly(value: 'YYYY-MM-DD'): Date     回傳該日 UTC 00:00:00.000；格式或日曆日期不合法 → 拋錯
 *   - formatDateOnly(date: Date): string           以 UTC 欄位格式化為 'YYYY-MM-DD'；Invalid Date → 拋錯
 * 依據：implementation-plan R11（Prisma @db.Date 是 UTC 午夜的 Date，與 Asia/Taipei 換算易差一天；
 *       全專案日期以 'YYYY-MM-DD' 字串流通，只在 repository 邊界轉換）。
 * 注意：不合法日期（如 2026-02-30）在 API 層應回 INVALID_ARGUMENT（以表單記帳.feature）；
 *       此處要求轉換函式本身也不得「悄悄進位」成別的日期（Date.UTC(2026,1,30) 會變成 3/2）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { formatDateOnly, parseDateOnly } from '../../../src/db/date-only';

const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('[Happy] parseDateOnly / formatDateOnly', () => {
  it('parseDateOnly 回傳 UTC 午夜', () => {
    const date = parseDateOnly('2026-11-12');
    expect(date.toISOString()).toBe('2026-11-12T00:00:00.000Z');
  });

  it('formatDateOnly 以 UTC 欄位格式化', () => {
    expect(formatDateOnly(new Date('2026-11-12T00:00:00.000Z'))).toBe('2026-11-12');
  });

  it('年底與年初邊界', () => {
    expect(parseDateOnly('2026-12-31').toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(parseDateOnly('2027-01-01').toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(parseDateOnly('1970-01-01').getTime()).toBe(0);
  });

  it('閏年 2024-02-29 合法', () => {
    expect(parseDateOnly('2024-02-29').toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });
});

describe('[Edge] 往返一致性（整個閏年 2024 的每一天）', () => {
  it('format(parse(s)) === s', () => {
    const start = Date.UTC(2024, 0, 1);
    for (let offset = 0; offset < 366; offset += 1) {
      const expected = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
      expect(formatDateOnly(parseDateOnly(expected))).toBe(expected);
    }
  });
});

describe('[Edge] 與行程時區無關（R11）', () => {
  it.each(['UTC', 'Asia/Taipei', 'America/Los_Angeles', 'Pacific/Kiritimati'])(
    'TZ=%s：往返不位移一天',
    (tz) => {
      process.env.TZ = tz;
      expect(formatDateOnly(parseDateOnly('2026-11-12'))).toBe('2026-11-12');
      expect(formatDateOnly(parseDateOnly('2026-01-01'))).toBe('2026-01-01');
      expect(parseDateOnly('2026-11-12').toISOString()).toBe('2026-11-12T00:00:00.000Z');
    },
  );

  it('formatDateOnly 取 UTC 日期：同一 UTC 日的最後一毫秒仍是該日', () => {
    process.env.TZ = 'Asia/Taipei';
    expect(formatDateOnly(new Date('2026-11-12T23:59:59.999Z'))).toBe('2026-11-12');
    expect(formatDateOnly(new Date('2026-11-13T00:00:00.000Z'))).toBe('2026-11-13');
  });
});

describe('[Error] 不合法的日期字串一律拋錯，不悄悄進位', () => {
  it.each([
    ['2 月 30 日', '2026-02-30'],
    ['非閏年 2 月 29 日', '2025-02-29'],
    ['13 月', '2026-13-01'],
    ['0 月', '2026-00-10'],
    ['0 日', '2026-11-00'],
    ['11 月 31 日', '2026-11-31'],
    ['32 日', '2026-01-32'],
  ])('日曆上不存在：%s（%s）', (_label, value) => {
    expect(() => parseDateOnly(value)).toThrow();
  });

  it.each([
    ['空字串', ''],
    ['月日未補零', '2026-1-5'],
    ['無分隔', '20261112'],
    ['斜線分隔', '2026/11/12'],
    ['含時間', '2026-11-12T00:00:00Z'],
    ['前後空白', ' 2026-11-12 '],
    ['全形數字', '２０２６-11-12'],
    ['年份只有 2 碼', '26-11-12'],
    ['文字', 'today'],
  ])('格式錯誤：%s', (_label, value) => {
    expect(() => parseDateOnly(value)).toThrow();
  });

  it('formatDateOnly 收到 Invalid Date → 拋錯', () => {
    expect(() => formatDateOnly(new Date('not-a-date'))).toThrow();
  });
});
