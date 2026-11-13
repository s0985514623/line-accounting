/**
 * AnnualReportPage（/annual?year=YYYY&ledger=）
 */
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from '../test/mocks/handlers';
import { server } from '../test/mocks/server';
import { renderRoutes } from '../test/render';
import { AnnualReportPage } from './AnnualReportPage';

/** 1–12 月金額，未指定的月份為 0。 */
function monthly(amounts: Record<number, number>): number[] {
  return Array.from({ length: 12 }, (_, index) => amounts[index + 1] ?? 0);
}

function months(overrides: Record<string, { incomeTotal: number; expenseTotal: number }>) {
  return Array.from({ length: 12 }, (_, index) => {
    const month = `2026-${String(index + 1).padStart(2, '0')}`;
    const totals = overrides[month] ?? { incomeTotal: 0, expenseTotal: 0 };
    return { month, ...totals, balance: totals.incomeTotal - totals.expenseTotal };
  });
}

const REPORT = {
  ledger: 'personal',
  year: 2026,
  incomeTotal: 600000,
  expenseTotal: 123456,
  balance: 476544,
  expenseByCategory: [
    {
      categoryId: 1,
      categoryName: '居住',
      amount: 100000,
      ratio: 81,
      monthlyAmounts: monthly({ 1: 50000, 3: 50000 }),
    },
    {
      categoryId: 2,
      categoryName: '餐飲',
      amount: 23456,
      ratio: 19,
      monthlyAmounts: monthly({ 3: 23456 }),
    },
  ],
  incomeByCategory: [
    {
      categoryId: 3,
      categoryName: '薪資',
      amount: 600000,
      ratio: 100,
      monthlyAmounts: monthly({ 12: 600000 }),
    },
  ],
  months: months({ '2026-03': { incomeTotal: 50000, expenseTotal: 8000 } }),
};

function useReport(capture?: (url: URL) => void) {
  server.use(
    http.get('/api/reports/annual', ({ request }) => {
      capture?.(new URL(request.url));
      return HttpResponse.json(REPORT);
    }),
  );
}

function renderPage(entry = '/annual?year=2026&ledger=personal') {
  return renderRoutes([{ path: '/annual', element: <AnnualReportPage /> }], entry);
}

describe('AnnualReportPage', () => {
  it('顯示全年合計、12 個月明細與分類佔比', async () => {
    let requested: URL | undefined;
    useReport((url) => {
      requested = url;
    });
    renderPage();

    const summary = await screen.findByRole('region', { name: '年度合計' });
    expect(summary).toHaveTextContent('600,000');
    expect(summary).toHaveTextContent('123,456');
    expect(summary).toHaveTextContent('476,544');
    expect(requested?.searchParams.get('year')).toBe('2026');

    const monthTable = screen.getByRole('table', { name: '每月明細' });
    const rows = within(monthTable).getAllByRole('row');
    expect(rows).toHaveLength(13); // 表頭 + 12 個月
    expect(within(monthTable).getByRole('link', { name: '3 月' })).toHaveAttribute(
      'href',
      '/chart?month=2026-03&ledger=personal',
    );
    expect(screen.getByRole('table', { name: '支出分類明細' })).toHaveTextContent('居住');
    expect(screen.getByRole('table', { name: '收入分類明細' })).toHaveTextContent('薪資');
  });

  it('點分類展開 1–12 月金額；有金額的月份連到該月統計並帶入分類，再點一次收合', async () => {
    useReport();
    const { user } = renderPage();
    const table = await screen.findByRole('table', { name: '支出分類明細' });

    const button = within(table).getByRole('button', { name: /居住/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    const list = screen.getByRole('list', { name: '居住每月金額' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(12);
    const march = within(list).getByRole('link', { name: /3 月/ });
    expect(march).toHaveTextContent('50,000');
    expect(march).toHaveAttribute(
      'href',
      '/chart?month=2026-03&ledger=personal&type=expense&category=1',
    );
    // 沒有金額的月份不可點
    expect(within(list).queryByRole('link', { name: /2 月/ })).not.toBeInTheDocument();
    expect(within(list).getAllByRole('link')).toHaveLength(2);

    // 同時只展開一個分類
    await user.click(within(table).getByRole('button', { name: /餐飲/ }));
    expect(screen.queryByRole('list', { name: '居住每月金額' })).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: '餐飲每月金額' })).toBeInTheDocument();

    await user.click(within(table).getByRole('button', { name: /餐飲/ }));
    expect(screen.queryByRole('list', { name: '餐飲每月金額' })).not.toBeInTheDocument();
  });

  it('收入分類展開 → 連結帶 type=income', async () => {
    useReport();
    const { user } = renderPage();
    const table = await screen.findByRole('table', { name: '收入分類明細' });
    await user.click(within(table).getByRole('button', { name: /薪資/ }));
    const list = screen.getByRole('list', { name: '薪資每月金額' });
    expect(within(list).getByRole('link', { name: /12 月/ })).toHaveAttribute(
      'href',
      '/chart?month=2026-12&ledger=personal&type=income&category=3',
    );
  });

  it('切換年度 → 以新年度查詢並更新網址', async () => {
    const years: (string | null)[] = [];
    useReport((url) => years.push(url.searchParams.get('year')));
    const { user } = renderPage();
    await screen.findByRole('region', { name: '年度合計' });

    await user.selectOptions(screen.getByRole('combobox', { name: '年度' }), '2025');
    await waitFor(() => expect(years).toContain('2025'));
    expect(screen.getByTestId('location-search')).toHaveTextContent('year=2025');
  });

  it('網址年份不合法 → 用今年', async () => {
    let requested: URL | undefined;
    useReport((url) => {
      requested = url;
    });
    renderPage('/annual?year=abc');
    await screen.findByRole('region', { name: '年度合計' });
    expect(requested?.searchParams.get('year')).toMatch(/^\d{4}$/);
    expect(requested?.searchParams.get('ledger')).toBe('personal');
  });
});
