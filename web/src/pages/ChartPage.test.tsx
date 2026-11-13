/**
 * ChartPage（路由 /liff/chart?month=YYYY-MM&ledger=personal|company → 元件內路徑 "/chart"）
 *
 * 執行：npm --prefix web test -- src/pages/ChartPage.test.tsx
 * 對應規格：specs/features/report/查詢月度統計圖表.feature、specs/api/api.yml（GET /api/reports/monthly）
 * 使用者決策：圖表頁預設「本月」「個人」。LINE 摘要的圖表連結即此路由（參數 month、ledger 為英文 enum）。
 * jsdom 下 Recharts 量不到尺寸、不會畫出 SVG，因此本檔只以「合計」與「分類明細表」的文字斷言，不依賴圖表 SVG。
 *
 * 假設的模組介面：
 *   web/src/pages/ChartPage.tsx   export function ChartPage()   （具名匯出、無 props）
 *   web/src/api/reports.ts        fetchMonthlyReport / useMonthlyReport（介面見 api/reports.test.ts）
 *   - 以 useSearchParams 讀 month、ledger；缺省時 month = 本月（Asia/Taipei）、ledger = personal
 *   - 一律以「解析後的值」發請求：GET /api/reports/monthly?month=YYYY-MM&ledger=...（兩個參數都帶）
 *   - 圖表（Recharts 長條 + 圓餅）放在 ResponsiveContainer 內；圖表只是視覺輔助，資訊全部也以文字呈現
 *
 * 測試依賴的 accessible name / 文案（react-master 請照此實作）：
 *   - 頁面標題：heading「統計圖表」
 *   - 月份選擇：<input type="month">，label「月份」（MonthPicker），值＝目前查詢月份
 *   - 帳本切換：radiogroup「帳本」→ radio「個人」「公司」（LedgerToggle），選中＝目前查詢帳本
 *       · 變更月份 / 帳本 → 以新參數重新查詢（是否同步更新網址列不在此測試範圍）
 *   - 載入中：role="status" 內含「載入中」
 *   - 合計：<section aria-label="月度合計">（role=region），內含 3 個 listitem，依序為
 *       「收入 {金額}」「支出 {金額}」「結餘 {金額}」；金額以 formatAmount 千分位、負數以「-」開頭、不加貨幣符號
 *   - 支出分類明細：<table> accessible name「支出分類明細」，欄位標題「分類」「金額」「佔比」；
 *       每筆分類一列，順序＝API 順序（金額由大到小）；金額千分位；佔比＝`${ratio.toFixed(1)}%`（75 → 「75.0%」）
 *       分類名稱一律以純文字渲染
 *   - 無支出（expenseByCategory 為空）：顯示文字「本月無支出」，且不渲染明細表；合計區仍顯示
 *   - 錯誤：role="alert"，內容為 ApiError.message（中文對照）；錯誤時不顯示合計與明細表
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartPage } from './ChartPage';
import {
  addMockTransaction,
  errorResponse,
  http,
  HttpResponse,
  requestsTo,
  VALID_ID_TOKEN,
} from '../test/mocks/handlers';
import { server } from '../test/mocks/server';
import { renderRoutes } from '../test/render';

/** 2026-11-12 12:00（Asia/Taipei）＝ 04:00Z，與 BDD 的固定時鐘一致 */
function freezeNow(iso = '2026-11-12T04:00:00Z') {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

function renderChart(search = '') {
  return renderRoutes([{ path: '/chart', element: <ChartPage /> }], {
    pathname: '/chart',
    search,
  });
}

function summaryItems() {
  const region = screen.getByRole('region', { name: '月度合計' });
  return within(region).getAllByRole('listitem');
}

function detailRows(name = '支出分類明細') {
  const table = screen.getByRole('table', { name });
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent?.trim()),
    );
}

function reportBody(overrides: Record<string, unknown> = {}) {
  return {
    ledger: 'personal',
    month: '2026-11',
    incomeTotal: 50000,
    expenseTotal: 400,
    balance: 49600,
    expenseByCategory: [
      { categoryName: '餐飲', amount: 300, ratio: 75.0 },
      { categoryName: '其他', amount: 100, ratio: 25.0 },
    ],
    ...overrides,
  };
}

function addPersonalTransport() {
  addMockTransaction({
    id: 200,
    ledger: 'personal',
    entryType: 'expense',
    item: '捷運',
    amount: 80,
    categoryId: 2,
    categoryName: '交通',
    occurredOn: '2026-11-04',
    note: null,
    source: 'line_text',
  });
}

beforeEach(() => {
  freezeNow();
});

describe('ChartPage', () => {
  describe('Smoke', () => {
    it('先顯示載入中，之後顯示合計與分類明細，請求帶 Bearer ID token', async () => {
      renderChart('?month=2026-11&ledger=personal');

      expect(screen.getByRole('heading', { name: '統計圖表' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('載入中');

      expect(await screen.findByRole('region', { name: '月度合計' })).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByRole('table', { name: '支出分類明細' })).toBeInTheDocument();
      const [req] = requestsTo('GET', '/api/reports/monthly');
      expect(req?.query).toEqual({ month: '2026-11', ledger: 'personal' });
      expect(req?.authorization).toBe(`Bearer ${VALID_ID_TOKEN}`);
    });
  });

  describe('Happy：讀取網址參數', () => {
    it('?month=2026-10&ledger=company → 以該月份與帳本查詢，控制項顯示對應值', async () => {
      renderChart('?month=2026-10&ledger=company');
      await screen.findByRole('region', { name: '月度合計' });

      expect(requestsTo('GET', '/api/reports/monthly')[0]?.query).toEqual({
        month: '2026-10',
        ledger: 'company',
      });
      expect(screen.getByLabelText('月份')).toHaveValue('2026-10');
      expect(screen.getByRole('radio', { name: '公司' })).toBeChecked();
      expect(screen.getByRole('radio', { name: '個人' })).not.toBeChecked();
    });

    it('只帶 ledger=company → month 預設本月（Asia/Taipei）', async () => {
      renderChart('?ledger=company');
      await screen.findByRole('region', { name: '月度合計' });

      expect(requestsTo('GET', '/api/reports/monthly')[0]?.query).toEqual({
        month: '2026-11',
        ledger: 'company',
      });
      expect(screen.getByLabelText('月份')).toHaveValue('2026-11');
    });

    it('只帶 month=2026-10 → ledger 預設個人', async () => {
      renderChart('?month=2026-10');
      await screen.findByRole('region', { name: '月度合計' });

      expect(requestsTo('GET', '/api/reports/monthly')[0]?.query).toEqual({
        month: '2026-10',
        ledger: 'personal',
      });
      expect(screen.getByRole('radio', { name: '個人' })).toBeChecked();
    });
  });

  describe('Happy：無參數預設本月個人', () => {
    it('沒有任何網址參數 → 查詢 2026-11 個人帳本，控制項顯示預設值', async () => {
      renderChart();
      await screen.findByRole('region', { name: '月度合計' });

      expect(requestsTo('GET', '/api/reports/monthly')[0]?.query).toEqual({
        month: '2026-11',
        ledger: 'personal',
      });
      expect(screen.getByLabelText('月份')).toHaveValue('2026-11');
      expect(screen.getByRole('radio', { name: '個人' })).toBeChecked();
      expect(screen.getByRole('radio', { name: '公司' })).not.toBeChecked();
    });

    it('「今天」依 Asia/Taipei：UTC 2026-11-30 16:30 已是台北 12/1 → 預設月份為 2026-12', async () => {
      freezeNow('2026-11-30T16:30:00Z');
      renderChart();
      await screen.findByRole('region', { name: '月度合計' });

      expect(requestsTo('GET', '/api/reports/monthly')[0]?.query).toEqual({
        month: '2026-12',
        ledger: 'personal',
      });
    });
  });

  describe('Happy：收入 / 支出 / 結餘', () => {
    it('個人 2026-11：收入 50,000、支出 320、結餘 49,680', async () => {
      renderChart('?month=2026-11&ledger=personal');
      await screen.findByRole('region', { name: '月度合計' });

      const items = summaryItems();
      expect(items).toHaveLength(3);
      expect(items[0]).toHaveTextContent(/收入\s*50,000/);
      expect(items[1]).toHaveTextContent(/支出\s*320/);
      expect(items[2]).toHaveTextContent(/結餘\s*49,680/);
    });

    it('feature 範例：收入 50000、支出 400、結餘 49600，並以千分位顯示', async () => {
      server.use(http.get('*/api/reports/monthly', () => HttpResponse.json(reportBody())));
      renderChart('?month=2026-11&ledger=personal');
      await screen.findByRole('region', { name: '月度合計' });

      const items = summaryItems();
      expect(items[0]).toHaveTextContent(/收入\s*50,000/);
      expect(items[1]).toHaveTextContent(/支出\s*400/);
      expect(items[2]).toHaveTextContent(/結餘\s*49,600/);
    });

    it('支出大於收入 → 結餘以負號顯示（個人 2026-10：收入 0、支出 90、結餘 -90）', async () => {
      renderChart('?month=2026-10&ledger=personal');
      await screen.findByRole('region', { name: '月度合計' });

      const items = summaryItems();
      expect(items[0]).toHaveTextContent(/收入\s*0/);
      expect(items[1]).toHaveTextContent(/支出\s*90/);
      expect(items[2]).toHaveTextContent(/結餘\s*-90/);
    });

    it('公司帳本 2026-11：只計公司的紀錄（收入 0、支出 300、結餘 -300）', async () => {
      renderChart('?month=2026-11&ledger=company');
      await screen.findByRole('region', { name: '月度合計' });

      const items = summaryItems();
      expect(items[1]).toHaveTextContent(/支出\s*300/);
      expect(items[2]).toHaveTextContent(/結餘\s*-300/);
    });
  });

  describe('Happy：收入分類明細表', () => {
    it('依 API 順序顯示收入分類金額與佔比', async () => {
      server.use(
        http.get('*/api/reports/monthly', () =>
          HttpResponse.json(
            reportBody({
              incomeTotal: 60000,
              balance: 59600,
              incomeByCategory: [
                { categoryName: '薪資', amount: 50000, ratio: 83.3 },
                { categoryName: '獎金', amount: 10000, ratio: 16.7 },
              ],
            }),
          ),
        ),
      );
      renderChart('?month=2026-11&ledger=personal');
      await screen.findByRole('table', { name: '收入分類明細' });

      expect(detailRows('收入分類明細')).toEqual([
        ['薪資', '50,000', '83.3%'],
        ['獎金', '10,000', '16.7%'],
      ]);
    });

    it('MSW 以記憶體紀錄計算：個人 2026-11 薪資 100.0%', async () => {
      renderChart('?month=2026-11&ledger=personal');
      await screen.findByRole('table', { name: '收入分類明細' });
      expect(detailRows('收入分類明細')).toEqual([['薪資', '50,000', '100.0%']]);
    });

    it('沒有收入 → 顯示「本月無收入」', async () => {
      server.use(
        http.get('*/api/reports/monthly', () =>
          HttpResponse.json(reportBody({ incomeTotal: 0, balance: -400, incomeByCategory: [] })),
        ),
      );
      renderChart('?month=2026-11&ledger=personal');
      expect(await screen.findByText('本月無收入')).toBeInTheDocument();
      expect(screen.queryByRole('table', { name: '收入分類明細' })).not.toBeInTheDocument();
    });
  });

  describe('Happy：分類明細表（含佔比）', () => {
    it('欄位標題為「分類」「金額」「佔比」', async () => {
      renderChart('?month=2026-11&ledger=personal');
      await screen.findByRole('table', { name: '支出分類明細' });

      const table = screen.getByRole('table', { name: '支出分類明細' });
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((h) => h.textContent?.trim()),
      ).toEqual(['分類', '金額', '佔比']);
    });

    it('feature 範例：餐飲 300 → 75.0%、其他 100 → 25.0%（依 API 順序）', async () => {
      server.use(http.get('*/api/reports/monthly', () => HttpResponse.json(reportBody())));
      renderChart('?month=2026-11&ledger=personal');
      await screen.findByRole('table', { name: '支出分類明細' });

      expect(detailRows()).toEqual([
        ['餐飲', '300', '75.0%'],
        ['其他', '100', '25.0%'],
      ]);
    });

    it('單一分類 → 100.0%（MSW 以記憶體紀錄計算）', async () => {
      renderChart('?month=2026-11&ledger=personal');
      await screen.findByRole('table', { name: '支出分類明細' });

      expect(detailRows()).toEqual([['餐飲', '320', '100.0%']]);
    });

    it('兩個分類 → 80.0% / 20.0%，金額由大到小', async () => {
      addPersonalTransport();
      renderChart('?month=2026-11&ledger=personal');
      await screen.findByRole('table', { name: '支出分類明細' });

      expect(detailRows()).toEqual([
        ['餐飲', '320', '80.0%'],
        ['交通', '80', '20.0%'],
      ]);
    });

    it('不整除的佔比 66.7% / 33.3% 原樣顯示一位小數', async () => {
      server.use(
        http.get('*/api/reports/monthly', () =>
          HttpResponse.json(
            reportBody({
              expenseTotal: 90,
              balance: 49910,
              expenseByCategory: [
                { categoryName: '餐飲', amount: 60, ratio: 66.7 },
                { categoryName: '交通', amount: 30, ratio: 33.3 },
              ],
            }),
          ),
        ),
      );
      renderChart('?month=2026-11&ledger=personal');
      await screen.findByRole('table', { name: '支出分類明細' });

      expect(detailRows()).toEqual([
        ['餐飲', '60', '66.7%'],
        ['交通', '30', '33.3%'],
      ]);
    });

    it('金額以千分位顯示（支出 99,999,999）', async () => {
      server.use(
        http.get('*/api/reports/monthly', () =>
          HttpResponse.json(
            reportBody({
              incomeTotal: 0,
              expenseTotal: 99_999_999,
              balance: -99_999_999,
              expenseByCategory: [{ categoryName: '餐飲', amount: 99_999_999, ratio: 100 }],
            }),
          ),
        ),
      );
      renderChart('?month=2026-11&ledger=personal');
      await screen.findByRole('table', { name: '支出分類明細' });

      expect(detailRows()).toEqual([['餐飲', '99,999,999', '100.0%']]);
      expect(summaryItems()[2]).toHaveTextContent(/結餘\s*-99,999,999/);
    });
  });

  describe('Happy：切換月份與帳本', () => {
    it('變更月份 → 以新月份重新查詢並更新畫面', async () => {
      renderChart('?month=2026-11&ledger=personal');
      await screen.findByRole('table', { name: '支出分類明細' });

      fireEvent.change(screen.getByLabelText('月份'), { target: { value: '2026-10' } });

      await waitFor(() => expect(summaryItems()[1]).toHaveTextContent(/支出\s*90/));
      expect(requestsTo('GET', '/api/reports/monthly').at(-1)?.query).toEqual({
        month: '2026-10',
        ledger: 'personal',
      });
    });

    it('切換帳本 → 以新帳本重新查詢並更新畫面', async () => {
      const { user } = renderChart('?month=2026-11&ledger=personal');
      await screen.findByRole('table', { name: '支出分類明細' });

      await user.click(screen.getByRole('radio', { name: '公司' }));

      await waitFor(() => expect(detailRows()).toEqual([['文具', '300', '100.0%']]));
      expect(requestsTo('GET', '/api/reports/monthly').at(-1)?.query).toEqual({
        month: '2026-11',
        ledger: 'company',
      });
      expect(screen.getByRole('radio', { name: '公司' })).toBeChecked();
    });
  });

  describe('Empty：無支出', () => {
    it('當月沒有支出 → 顯示「本月無支出」，不渲染明細表，合計仍顯示', async () => {
      renderChart('?month=2026-09&ledger=company');

      expect(await screen.findByText('本月無支出')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      const items = summaryItems();
      expect(items[0]).toHaveTextContent(/收入\s*0/);
      expect(items[1]).toHaveTextContent(/支出\s*0/);
      expect(items[2]).toHaveTextContent(/結餘\s*0/);
    });

    it('只有收入沒有支出 → 仍顯示「本月無支出」，收入與結餘照常顯示', async () => {
      server.use(
        http.get('*/api/reports/monthly', () =>
          HttpResponse.json(
            reportBody({
              expenseTotal: 0,
              balance: 50000,
              expenseByCategory: [],
            }),
          ),
        ),
      );
      renderChart('?month=2026-11&ledger=personal');

      expect(await screen.findByText('本月無支出')).toBeInTheDocument();
      expect(summaryItems()[0]).toHaveTextContent(/收入\s*50,000/);
      expect(summaryItems()[2]).toHaveTextContent(/結餘\s*50,000/);
    });

    it('從有支出的月份切到無支出的月份 → 明細表消失、出現「本月無支出」', async () => {
      renderChart('?month=2026-11&ledger=personal');
      await screen.findByRole('table', { name: '支出分類明細' });

      fireEvent.change(screen.getByLabelText('月份'), { target: { value: '2026-09' } });

      expect(await screen.findByText('本月無支出')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('Error', () => {
    it('400 INVALID_ARGUMENT → 顯示中文錯誤，不顯示合計與明細表', async () => {
      server.use(http.get('*/api/reports/monthly', () => errorResponse(400, 'INVALID_ARGUMENT')));
      renderChart('?month=2026-11&ledger=personal');

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('輸入的資料有誤，請檢查後再試');
      expect(alert).not.toHaveTextContent('server says');
      expect(screen.queryByRole('region', { name: '月度合計' })).not.toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByText('本月無支出')).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('403 FORBIDDEN → 顯示無權限訊息', async () => {
      server.use(http.get('*/api/reports/monthly', () => errorResponse(403, 'FORBIDDEN')));
      renderChart('?month=2026-11&ledger=personal');

      expect(await screen.findByRole('alert')).toHaveTextContent('您沒有使用此服務的權限');
    });

    it('500 → 顯示伺服器錯誤訊息', async () => {
      server.use(http.get('*/api/reports/monthly', () => HttpResponse.json({}, { status: 500 })));
      renderChart('?month=2026-11&ledger=personal');

      expect(await screen.findByRole('alert')).toHaveTextContent('伺服器發生錯誤，請稍後再試');
    });

    it('網路中斷 → 顯示網路錯誤訊息', async () => {
      server.use(http.get('*/api/reports/monthly', () => HttpResponse.error()));
      renderChart('?month=2026-11&ledger=personal');

      expect(await screen.findByRole('alert')).toHaveTextContent('網路連線失敗，請檢查網路後再試');
    });

    it('回應格式不符 → 顯示「伺服器回應格式不正確」', async () => {
      server.use(http.get('*/api/reports/monthly', () => HttpResponse.json({ hello: 'world' })));
      renderChart('?month=2026-11&ledger=personal');

      expect(await screen.findByRole('alert')).toHaveTextContent('伺服器回應格式不正確');
    });

    it('錯誤之後改選其他月份可恢復（錯誤橫幅消失、顯示新資料）', async () => {
      server.use(
        http.get('*/api/reports/monthly', () => errorResponse(400, 'INVALID_ARGUMENT'), {
          once: true,
        }),
      );
      renderChart('?month=2026-11&ledger=personal');
      await screen.findByRole('alert');

      fireEvent.change(screen.getByLabelText('月份'), { target: { value: '2026-10' } });

      expect(await screen.findByRole('region', { name: '月度合計' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(summaryItems()[1]).toHaveTextContent(/支出\s*90/);
    });
  });

  describe('Edge：網址參數不合法', () => {
    it.each([
      '?month=2026-13&ledger=personal',
      '?month=202611',
      '?ledger=family',
      '?month=&ledger=',
    ])(
      '%s → 頁面不白畫面：標題仍在，且最後呈現報表或錯誤訊息其一（採用何者由實作決定，不得停在載入中）',
      async (search) => {
        renderChart(search);

        await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
        expect(screen.getByRole('heading', { name: '統計圖表' })).toBeInTheDocument();
        const hasReport = screen.queryByRole('region', { name: '月度合計' }) !== null;
        const hasAlert = screen.queryByRole('alert') !== null;
        expect(hasReport || hasAlert).toBe(true);
      },
    );
  });

  describe('Security', () => {
    it('分類名稱含 HTML 字串時以純文字顯示，不產生元素', async () => {
      const evil = '<img src=x onerror=alert(1)>';
      server.use(
        http.get('*/api/reports/monthly', () =>
          HttpResponse.json(
            reportBody({
              expenseTotal: 100,
              balance: 49900,
              expenseByCategory: [{ categoryName: evil, amount: 100, ratio: 100 }],
            }),
          ),
        ),
      );
      const { container } = renderChart('?month=2026-11&ledger=personal');

      const table = await screen.findByRole('table', { name: '支出分類明細' });
      expect(within(table).getByText(evil)).toBeInTheDocument();
      expect(container.querySelector('img')).toBeNull();
    });
  });
});
