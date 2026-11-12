/**
 * Express app factory。所有外部依賴經 deps 注入（BDD / HTTP 測試注入固定時鐘、LINE stub、身分 stub）。
 */
import type { PrismaClient } from '@prisma/client';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { AppConfig } from './config/env';
import { createErrorHandler } from './http/middleware/error-handler';
import { createRequestLogger } from './http/middleware/request-logger';
import { API_PREFIX, createApiRouter } from './http/routes/api';
import { createHealthRouter } from './http/routes/health';
import { EventDispatcher } from './line/event-dispatcher';
import { FollowHandler } from './line/handlers/follow-handler';
import { PostbackHandler } from './line/handlers/postback-handler';
import { TextMessageHandler } from './line/handlers/text-message-handler';
import { createWebhookRouter } from './line/webhook-route';
import { createLogger } from './logging/logger';
import type { Clock } from './ports/clock';
import type { IdTokenVerifier } from './ports/id-token-verifier';
import type { LineReplyGateway } from './ports/line-reply-gateway';
import { CategoryService } from './services/category-service';
import { OnboardingService } from './services/onboarding-service';
import { ReportService } from './services/report-service';
import { TransactionService } from './services/transaction-service';

export interface AppDeps {
  prisma: PrismaClient;
  clock: Clock;
  lineGateway: LineReplyGateway;
  idTokenVerifier: IdTokenVerifier;
  config: AppConfig;
  /** 未提供時依 config.logLevel 建立 */
  logger?: Logger;
}

/** 由 route / handler 共用的 service（每個 app 各一組）。 */
interface AppServices {
  onboarding: OnboardingService;
  categories: CategoryService;
  transactions: TransactionService;
  reports: ReportService;
}

function createServices(deps: AppDeps): AppServices {
  const onboarding = new OnboardingService(deps.prisma);
  return {
    onboarding,
    categories: new CategoryService(deps.prisma),
    transactions: new TransactionService({ prisma: deps.prisma, clock: deps.clock, onboarding }),
    reports: new ReportService(deps.prisma),
  };
}

export function createApp(deps: AppDeps): Express {
  const logger = deps.logger ?? createLogger({ level: deps.config.logLevel });
  const services = createServices(deps);
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(createRequestLogger(logger));

  app.use(createHealthRouter(deps.prisma, logger));
  app.use(
    createWebhookRouter({
      channelSecret: deps.config.channelSecret,
      dispatcher: createEventDispatcher(deps, services, logger),
      logger,
    }),
  );
  app.use(
    API_PREFIX,
    createApiRouter({
      verifier: deps.idTokenVerifier,
      ownerUserId: deps.config.ownerUserId,
      logger,
      categories: services.categories,
      transactions: services.transactions,
      reports: services.reports,
      clock: deps.clock,
    }),
  );

  app.use(createErrorHandler(logger));
  return app;
}

/** 組裝 webhook 事件分派（service → handler → dispatcher）。 */
function createEventDispatcher(
  deps: AppDeps,
  services: AppServices,
  logger: Logger,
): EventDispatcher {
  return new EventDispatcher({
    ownerUserId: deps.config.ownerUserId,
    gateway: deps.lineGateway,
    handlers: {
      follow: new FollowHandler(services.onboarding),
      message: new TextMessageHandler({
        transactions: services.transactions,
        reports: services.reports,
        clock: deps.clock,
        liffId: deps.config.liffId,
      }),
      postback: new PostbackHandler(services.transactions, logger),
    },
    logger,
  });
}
