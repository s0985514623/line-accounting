/**
 * /api/* 總入口：先過 liff-auth（未通過不解析 body、不碰資料），再解析 JSON 並分派各資源 router。
 * 未知路徑回 404 NOT_FOUND（Error 形狀）。
 */
import express, { Router } from 'express';
import type { Logger } from 'pino';
import { DomainError } from '../../domain/errors';
import type { Clock } from '../../ports/clock';
import type { IdTokenVerifier } from '../../ports/id-token-verifier';
import type { CategoryService } from '../../services/category-service';
import type { RecurringService } from '../../services/recurring-service';
import type { ReportService } from '../../services/report-service';
import type { TransactionService } from '../../services/transaction-service';
import { createLiffAuth } from '../middleware/liff-auth';
import { createCategoriesRouter } from './categories';
import { createRecurringRouter } from './recurring';
import { createReportsRouter } from './reports';
import { createTransactionsRouter } from './transactions';

export const API_PREFIX = '/api';
const JSON_BODY_LIMIT = '16kb';

export interface ApiRouterDeps {
  verifier: IdTokenVerifier;
  ownerUserId: string;
  logger: Logger;
  categories: CategoryService;
  transactions: TransactionService;
  reports: ReportService;
  recurring: RecurringService;
  /** 月度統計省略 month 時決定「本月」 */
  clock: Clock;
}

export function createApiRouter(deps: ApiRouterDeps): Router {
  const router = Router();

  router.use(
    createLiffAuth({
      verifier: deps.verifier,
      ownerUserId: deps.ownerUserId,
      logger: deps.logger,
    }),
  );
  router.use(express.json({ limit: JSON_BODY_LIMIT }));

  router.use(createCategoriesRouter(deps.categories));
  router.use(createTransactionsRouter(deps.transactions));
  router.use(createReportsRouter({ reports: deps.reports, clock: deps.clock }));
  router.use(createRecurringRouter(deps.recurring));

  router.use((_req, _res, next) => {
    next(new DomainError('NOT_FOUND', '找不到此 API'));
  });

  return router;
}
