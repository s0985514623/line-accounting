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
import { createHealthRouter } from './http/routes/health';
import { createLogger } from './logging/logger';
import type { Clock } from './ports/clock';
import type { IdTokenVerifier } from './ports/id-token-verifier';
import type { LineReplyGateway } from './ports/line-reply-gateway';

export interface AppDeps {
  prisma: PrismaClient;
  clock: Clock;
  lineGateway: LineReplyGateway;
  idTokenVerifier: IdTokenVerifier;
  config: AppConfig;
  /** 未提供時依 config.logLevel 建立 */
  logger?: Logger;
}

export function createApp(deps: AppDeps): Express {
  const logger = deps.logger ?? createLogger({ level: deps.config.logLevel });
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(createRequestLogger(logger));

  app.use(createHealthRouter(deps.prisma, logger));

  app.use(createErrorHandler(logger));
  return app;
}
