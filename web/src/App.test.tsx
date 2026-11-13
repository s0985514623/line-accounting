/**
 * App 路由（BrowserRouter basename="/liff"）：新增 /categories、/chart 兩個路由與列表頁的導覽連結。
 *
 * 執行：npm --prefix web test -- src/App.test.tsx
 * 對應計劃：implementation-plan 第 8 階段（CategoryPage `/liff/categories`、ChartPage `/liff/chart?month&ledger`）；
 *          LINE 摘要的圖表連結為 https://liff.line.me/{LIFF_ID}/chart?month=YYYY-MM&ledger=personal|company。
 *
 * 假設的模組介面：
 *   web/src/App.tsx  Routes 新增
 *     <Route path="/categories" element={<CategoryPage />} />
 *     <Route path="/chart" element={<ChartPage />} />
 *   TransactionListPage 標題列新增兩個連結：
 *     link「分類管理」→ /categories（瀏覽器實際 href = /liff/categories）
 *     link「統計圖表」→ /chart（href 以 /liff/chart 開頭；可選擇帶入目前 month / ledger，本測試不限定）
 *   既有行為不變：/、/new、/edit/:id；其餘路徑導回 /
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { requestsTo } from './test/mocks/handlers';

function visit(path: string) {
  window.history.replaceState({}, '', path);
  return render(<App />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T04:00:00Z'));
});

afterEach(() => {
  act(() => window.history.replaceState({}, '', '/liff/'));
});

describe('App 路由', () => {
  // 圖表 / 年報頁為 lazy chunk（含 Recharts）；vite 轉譯快取冷時首次載入可能超過數秒。
  // 先在 hook（較長逾時）內載入一次，讓各測試的 lazy() 立即完成，避免 findBy 逾時造成的偶發失敗。
  beforeAll(async () => {
    await Promise.all([import('./pages/ChartPage'), import('./pages/AnnualReportPage')]);
  }, 60_000);

  describe('Smoke', () => {
    it('/liff/categories 顯示分類管理頁', async () => {
      visit('/liff/categories');

      expect(await screen.findByRole('heading', { name: '分類管理' })).toBeInTheDocument();
      expect(await screen.findByText('餐飲')).toBeInTheDocument();
    });

    it('/liff/chart 顯示統計圖表頁（無參數＝本月個人）', async () => {
      visit('/liff/chart');

      expect(await screen.findByRole('heading', { name: '統計圖表' })).toBeInTheDocument();
      await screen.findByRole('region', { name: '月度合計' });
      expect(requestsTo('GET', '/api/reports/monthly')[0]?.query).toEqual({
        month: '2026-11',
        ledger: 'personal',
      });
    });

    it('LINE 摘要連結 /liff/chart?month=2026-10&ledger=company 以參數查詢', async () => {
      visit('/liff/chart?month=2026-10&ledger=company');

      await screen.findByRole('region', { name: '月度合計' });
      expect(requestsTo('GET', '/api/reports/monthly')[0]?.query).toEqual({
        month: '2026-10',
        ledger: 'company',
      });
      expect(screen.getByRole('radio', { name: '公司' })).toBeChecked();
    });
  });

  describe('Happy：列表頁導覽', () => {
    it('列表頁有「分類管理」「統計圖表」連結，href 帶 /liff 前綴', async () => {
      visit('/liff/');
      await screen.findByRole('heading', { name: '記帳紀錄' });

      expect(screen.getByRole('link', { name: '分類管理' })).toHaveAttribute(
        'href',
        '/liff/categories',
      );
      expect(screen.getByRole('link', { name: '統計圖表' }).getAttribute('href')).toMatch(
        /^\/liff\/chart(\?|$)/,
      );
    });

    it('點「分類管理」→ 進入分類管理頁', async () => {
      const user = userEvent.setup();
      visit('/liff/');
      await screen.findByRole('heading', { name: '記帳紀錄' });

      await user.click(screen.getByRole('link', { name: '分類管理' }));

      expect(await screen.findByRole('heading', { name: '分類管理' })).toBeInTheDocument();
      expect(window.location.pathname).toBe('/liff/categories');
    });

    it('點「統計圖表」→ 進入統計圖表頁', async () => {
      const user = userEvent.setup();
      visit('/liff/');
      await screen.findByRole('heading', { name: '記帳紀錄' });

      await user.click(screen.getByRole('link', { name: '統計圖表' }));

      expect(await screen.findByRole('heading', { name: '統計圖表' })).toBeInTheDocument();
      await waitFor(() => expect(window.location.pathname).toBe('/liff/chart'));
    });
  });

  describe('Regression：既有路由不變', () => {
    it('未知路徑仍導回列表頁', async () => {
      visit('/liff/not-a-page');

      expect(await screen.findByRole('heading', { name: '記帳紀錄' })).toBeInTheDocument();
      expect(window.location.pathname).toMatch(/^\/liff\/?$/);
    });

    it('/liff/new 仍為表單頁', async () => {
      visit('/liff/new');

      expect(await screen.findByLabelText('項目')).toBeInTheDocument();
    });
  });
});
