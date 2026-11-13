/**
 * 月度統計 API（GET /api/reports/monthly）與對應的 TanStack Query hook。
 */
import { useQuery } from '@tanstack/react-query';
import { request } from './http';
import {
  annualReportSchema,
  monthlyReportSchema,
  type TAnnualReport,
  type TLedger,
  type TMonthlyReport,
} from './schemas';

/** 月度統計查詢共用的 query key 前綴。 */
export const MONTHLY_REPORT_QUERY_KEY = ['reports', 'monthly'] as const;

export type TMonthlyReportParams = {
  /** YYYY-MM；省略時由伺服器預設本月（Asia/Taipei） */
  month?: string;
  /** 省略時由伺服器預設 personal */
  ledger?: TLedger;
};

/** 取得月度統計；值為 undefined 的參數不帶入 query string。 */
export function fetchMonthlyReport(params: TMonthlyReportParams = {}): Promise<TMonthlyReport> {
  return request('/api/reports/monthly', {
    query: { month: params.month, ledger: params.ledger },
    schema: monthlyReportSchema,
  });
}

/**
 * 取得月度統計的 Hook。
 * @param month YYYY-MM（undefined 時交由伺服器預設）
 * @param ledger 帳本（undefined 時交由伺服器預設）
 */
export function useMonthlyReport(month: string | undefined, ledger: TLedger | undefined) {
  return useQuery({
    queryKey: [...MONTHLY_REPORT_QUERY_KEY, month, ledger],
    queryFn: () => fetchMonthlyReport({ month, ledger }),
  });
}

/** 年度統計查詢共用的 query key 前綴。 */
export const ANNUAL_REPORT_QUERY_KEY = ['reports', 'annual'] as const;

/** 取得年度統計（GET /api/reports/annual）。 */
export function fetchAnnualReport(year: number, ledger: TLedger): Promise<TAnnualReport> {
  return request('/api/reports/annual', {
    query: { year: String(year), ledger },
    schema: annualReportSchema,
  });
}

/**
 * 取得年度統計的 Hook。
 * @param year 西元年
 * @param ledger 帳本
 */
export function useAnnualReport(year: number, ledger: TLedger) {
  return useQuery({
    queryKey: [...ANNUAL_REPORT_QUERY_KEY, year, ledger],
    queryFn: () => fetchAnnualReport(year, ledger),
  });
}
