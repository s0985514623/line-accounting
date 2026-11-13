import { describe, expect, it } from 'vitest';
import { buildAnnualReport } from '../../../src/domain/annual-report';
import { yearRange } from '../../../src/domain/date-utils';

describe('yearRange', () => {
  it('[1/1, 隔年 1/1)', () => {
    expect(yearRange(2026)).toEqual({ start: '2026-01-01', endExclusive: '2027-01-01' });
  });
});

describe('buildAnnualReport', () => {
  it('合計、分類佔比與 12 個月（無紀錄月份為 0）', () => {
    const report = buildAnnualReport({
      ledger: 'personal',
      year: 2026,
      categoryRows: [
        { entryType: 'expense', categoryId: 1, categoryName: '餐飲', amount: 300 },
        { entryType: 'expense', categoryId: 2, categoryName: '交通', amount: 100 },
        { entryType: 'income', categoryId: 3, categoryName: '薪資', amount: 1000 },
      ],
      monthRows: [
        { month: '2026-01', entryType: 'expense', categoryId: 1, amount: 300 },
        { month: '2026-01', entryType: 'expense', categoryId: 2, amount: 100 },
        { month: '2026-12', entryType: 'income', categoryId: 3, amount: 1000 },
      ],
    });

    expect(report).toMatchObject({
      ledger: 'personal',
      year: 2026,
      incomeTotal: 1000,
      expenseTotal: 400,
      balance: 600,
    });
    expect(report.expenseByCategory.map((s) => [s.categoryName, s.ratio])).toEqual([
      ['餐飲', 75],
      ['交通', 25],
    ]);
    expect(report.months).toHaveLength(12);
    expect(report.months[0]).toEqual({
      month: '2026-01',
      incomeTotal: 0,
      expenseTotal: 400,
      balance: -400,
    });
    expect(report.months[5]).toEqual({
      month: '2026-06',
      incomeTotal: 0,
      expenseTotal: 0,
      balance: 0,
    });
    expect(report.months[11]?.balance).toBe(1000);
    expect(report.expenseByCategory[0]?.monthlyAmounts).toEqual([
      300, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(report.expenseByCategory[1]?.monthlyAmounts[0]).toBe(100);
    expect(report.incomeByCategory[0]?.monthlyAmounts[11]).toBe(1000);
  });
});
