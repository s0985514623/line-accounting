/**
 * 月度統計 API client（GET /api/reports/monthly）。
 *
 * 執行：npm --prefix web test -- src/api/reports.test.ts
 * 對應規格：specs/features/report/查詢月度統計圖表.feature、specs/api/api.yml（MonthlyReport）
 *
 * 假設的模組介面：
 *   web/src/api/schemas.ts（新增）
 *     monthlyReportSchema   zod：{ ledger, month, incomeTotal, expenseTotal, balance,
 *                                  expenseByCategory: { categoryName: string; amount: int; ratio: number }[] }
 *     type TMonthlyReport
 *   web/src/api/reports.ts
 *     MONTHLY_REPORT_QUERY_KEY = ['reports', 'monthly'] as const
 *     fetchMonthlyReport(params?: { month?: string; ledger?: TLedger }): Promise<TMonthlyReport>
 *       - 值為 undefined 的參數不帶入 query string
 *       - 以 monthlyReportSchema 解析；形狀不符 → ApiError(INVALID_RESPONSE)
 *     useMonthlyReport(month: string | undefined, ledger: TLedger | undefined)
 *       - TanStack Query hook，queryKey = [...MONTHLY_REPORT_QUERY_KEY, month, ledger]
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from './http';
import { fetchMonthlyReport, MONTHLY_REPORT_QUERY_KEY } from './reports';
import {
  addMockTransaction,
  errorResponse,
  http,
  HttpResponse,
  requestsTo,
  VALID_ID_TOKEN,
} from '../test/mocks/handlers';
import { liffMock } from '../test/mocks/liff';
import { server } from '../test/mocks/server';

async function catchError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('預期 fetchMonthlyReport 應該失敗，但成功了');
}

const emptyReport = {
  ledger: 'personal',
  month: '2026-11',
  incomeTotal: 0,
  expenseTotal: 0,
  balance: 0,
  expenseByCategory: [],
};

describe('api/reports / fetchMonthlyReport', () => {
  describe('Smoke', () => {
    it('帶 month 與 ledger 查詢，回傳解析後的統計並帶 Bearer ID token', async () => {
      const report = await fetchMonthlyReport({ month: '2026-11', ledger: 'personal' });

      expect(report).toEqual({
        ledger: 'personal',
        month: '2026-11',
        incomeTotal: 50000,
        expenseTotal: 320,
        balance: 49680,
        expenseByCategory: [{ categoryId: 1, categoryName: '餐飲', amount: 320, ratio: 100 }],
        incomeByCategory: [{ categoryId: 3, categoryName: '薪資', amount: 50000, ratio: 100 }],
      });
      const [req] = requestsTo('GET', '/api/reports/monthly');
      expect(req?.query).toEqual({ month: '2026-11', ledger: 'personal' });
      expect(req?.authorization).toBe(`Bearer ${VALID_ID_TOKEN}`);
      expect(MONTHLY_REPORT_QUERY_KEY).toEqual(['reports', 'monthly']);
    });
  });

  describe('Happy', () => {
    it('公司帳本：回傳該帳本該月的合計', async () => {
      const report = await fetchMonthlyReport({ month: '2026-11', ledger: 'company' });

      expect(report.ledger).toBe('company');
      expect(report.incomeTotal).toBe(0);
      expect(report.expenseTotal).toBe(300);
      expect(report.balance).toBe(-300);
      expect(report.expenseByCategory).toEqual([
        { categoryId: 5, categoryName: '文具', amount: 300, ratio: 100 },
      ]);
    });

    it('未提供參數時不帶 query string（由伺服器預設本月個人）', async () => {
      await fetchMonthlyReport();

      const [req] = requestsTo('GET', '/api/reports/monthly');
      expect(req?.query).toEqual({});
    });

    it('只提供 ledger 時只帶 ledger（undefined 的 month 不送出）', async () => {
      await fetchMonthlyReport({ ledger: 'company' });

      expect(requestsTo('GET', '/api/reports/monthly')[0]?.query).toEqual({ ledger: 'company' });
    });

    it('支出分類依 API 順序（金額由大到小）原樣回傳', async () => {
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

      const report = await fetchMonthlyReport({ month: '2026-11', ledger: 'personal' });

      expect(report.expenseByCategory).toEqual([
        { categoryId: 1, categoryName: '餐飲', amount: 320, ratio: 80 },
        { categoryId: 2, categoryName: '交通', amount: 80, ratio: 20 },
      ]);
    });
  });

  describe('Edge', () => {
    it('沒有支出的月份：expenseByCategory 為空陣列、結餘等於收入', async () => {
      const report = await fetchMonthlyReport({ month: '2026-09', ledger: 'company' });

      expect(report).toMatchObject({
        incomeTotal: 0,
        expenseTotal: 0,
        balance: 0,
        expenseByCategory: [],
      });
    });

    it('負結餘與 66.7 / 33.3 這類不整除佔比不被改動', async () => {
      server.use(
        http.get('*/api/reports/monthly', () =>
          HttpResponse.json({
            ledger: 'personal',
            month: '2026-10',
            incomeTotal: 0,
            expenseTotal: 90,
            balance: -90,
            expenseByCategory: [
              { categoryName: '餐飲', amount: 60, ratio: 66.7 },
              { categoryName: '交通', amount: 30, ratio: 33.3 },
            ],
          }),
        ),
      );

      const report = await fetchMonthlyReport({ month: '2026-10', ledger: 'personal' });

      expect(report.balance).toBe(-90);
      expect(report.expenseByCategory.map((c: { ratio: number }) => c.ratio)).toEqual([66.7, 33.3]);
    });
  });

  describe('Error', () => {
    it('400 INVALID_ARGUMENT → ApiError，message 為中文對照而非伺服器原文', async () => {
      const error = await catchError(fetchMonthlyReport({ month: '2026-13', ledger: 'personal' }));

      expect(error.status).toBe(400);
      expect(error.violationType).toBe('INVALID_ARGUMENT');
      expect(error.message).toBe('輸入的資料有誤，請檢查後再試');
      expect(error.message).not.toContain('server says');
    });

    it('403 FORBIDDEN → 無權限訊息', async () => {
      server.use(http.get('*/api/reports/monthly', () => errorResponse(403, 'FORBIDDEN')));

      const error = await catchError(fetchMonthlyReport({ month: '2026-11', ledger: 'personal' }));

      expect(error.violationType).toBe('FORBIDDEN');
      expect(error.message).toBe('您沒有使用此服務的權限');
    });

    it('500 → SERVER_ERROR', async () => {
      server.use(
        http.get('*/api/reports/monthly', () => HttpResponse.json({ oops: true }, { status: 500 })),
      );

      const error = await catchError(fetchMonthlyReport({ month: '2026-11', ledger: 'personal' }));

      expect(error.violationType).toBe('SERVER_ERROR');
    });

    it('網路中斷 → NETWORK_ERROR', async () => {
      server.use(http.get('*/api/reports/monthly', () => HttpResponse.error()));

      const error = await catchError(fetchMonthlyReport({ month: '2026-11', ledger: 'personal' }));

      expect(error.violationType).toBe('NETWORK_ERROR');
      expect(error.status).toBe(0);
    });

    it('回應缺少 expenseByCategory → INVALID_RESPONSE', async () => {
      const { expenseByCategory: _omitted, ...withoutCategories } = emptyReport;
      server.use(http.get('*/api/reports/monthly', () => HttpResponse.json(withoutCategories)));

      const error = await catchError(fetchMonthlyReport({ month: '2026-11', ledger: 'personal' }));

      expect(error.violationType).toBe('INVALID_RESPONSE');
    });

    it('回應 ledger 不是 personal / company → INVALID_RESPONSE', async () => {
      server.use(
        http.get('*/api/reports/monthly', () =>
          HttpResponse.json({ ...emptyReport, ledger: 'family' }),
        ),
      );

      const error = await catchError(fetchMonthlyReport({ month: '2026-11', ledger: 'personal' }));

      expect(error.violationType).toBe('INVALID_RESPONSE');
    });

    it('401 → 呼叫 liff.login 後重送一次（R10，沿用 http 層）', async () => {
      let calls = 0;
      server.use(
        http.get('*/api/reports/monthly', () => {
          calls += 1;
          return calls > 1 ? HttpResponse.json(emptyReport) : errorResponse(401, 'UNAUTHENTICATED');
        }),
      );

      const report = await fetchMonthlyReport({ month: '2026-11', ledger: 'personal' });

      expect(report.month).toBe('2026-11');
      expect(liffMock.login).toHaveBeenCalledTimes(1);
      expect(requestsTo('GET', '/api/reports/monthly')).toHaveLength(2);
    });
  });
});
