/**
 * 月度統計 API 輸入驗證（specs/api/api.yml：getMonthlyReport）。
 * month、ledger 皆可省略（預設值由路由依時鐘決定）；若提供則必須合法。
 */
import { z } from 'zod';
import { LedgerSchema, MonthSchema } from './common';

export const MonthlyReportQuerySchema = z.object({
  month: MonthSchema.optional(),
  ledger: LedgerSchema.optional(),
});

export type MonthlyReportQuery = z.infer<typeof MonthlyReportQuerySchema>;
