/**
 * 月度統計 API（specs/api/api.yml getMonthlyReport）：
 *  GET /api/reports/monthly?month=&ledger=  → 200 MonthlyReport
 *  省略 month → 本月（Asia/Taipei，依注入的 clock）；省略 ledger → personal。
 *  GET /api/reports/annual?year=&ledger=   → 200 AnnualReport（省略 year → 今年）
 * 計算由 ReportService（與 LINE 月度文字摘要共用）負責。
 */
import { Router } from 'express';
import { resolveSummaryMonth, todayInTaipei } from '../../domain/date-utils';
import type { Ledger } from '../../domain/enums';
import type { Clock } from '../../ports/clock';
import type { ReportService } from '../../services/report-service';
import { asyncHandler } from '../async-handler';
import { toAnnualReportDto, toMonthlyReportDto } from '../mappers';
import { parseInput } from '../schemas/parse-input';
import { AnnualReportQuerySchema, MonthlyReportQuerySchema } from '../schemas/report';

const DEFAULT_LEDGER: Ledger = 'personal';

export interface ReportsRouterDeps {
  reports: ReportService;
  clock: Clock;
}

export function createReportsRouter(deps: ReportsRouterDeps): Router {
  const router = Router();

  router.get(
    '/reports/monthly',
    asyncHandler(async (req, res) => {
      const query = parseInput(MonthlyReportQuerySchema, req.query);
      const month = query.month ?? resolveSummaryMonth('this_month', deps.clock.now());
      const ledger = query.ledger ?? DEFAULT_LEDGER;
      const report = await deps.reports.getMonthlyReport(ledger, month);
      res.status(200).json(toMonthlyReportDto(report));
    }),
  );

  router.get(
    '/reports/annual',
    asyncHandler(async (req, res) => {
      const query = parseInput(AnnualReportQuerySchema, req.query);
      const year = query.year ?? Number(todayInTaipei(deps.clock.now()).slice(0, 4));
      const ledger = query.ledger ?? DEFAULT_LEDGER;
      const report = await deps.reports.getAnnualReport(ledger, year);
      res.status(200).json(toAnnualReportDto(report));
    }),
  );

  return router;
}
