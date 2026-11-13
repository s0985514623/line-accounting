/**
 * 進入點：讀 env → 建立 deps → listen → graceful shutdown（SIGTERM / SIGINT）。
 */
import type { Server } from 'node:http';
import { messagingApi } from '@line/bot-sdk';
import { LineIdTokenVerifier } from './adapters/line-id-token-verifier';
import { LineMessagingGateway } from './adapters/line-messaging-gateway';
import { SystemClock } from './adapters/system-clock';
import { createApp } from './app';
import { EnvValidationError, loadEnv, toAppConfig } from './config/env';
import { disconnectPrismaClient, getPrismaClient } from './db/prisma';
import { createLogger } from './logging/logger';
import { RecurringScheduler } from './scheduler/recurring-scheduler';
import { RecurringService } from './services/recurring-service';

/** 等待進行中請求的上限；逾時強制結束。 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

function main(): void {
  let env;
  try {
    env = loadEnv(process.env);
  } catch (error) {
    // 只輸出 key 名稱（EnvValidationError 的訊息不含值）
    const message = error instanceof EnvValidationError ? error.message : '環境變數驗證失敗';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }

  const config = toAppConfig(env);
  const logger = createLogger({ level: config.logLevel });
  const prisma = getPrismaClient(env.DATABASE_URL);

  const clock = new SystemClock();
  const lineGateway = new LineMessagingGateway(
    new messagingApi.MessagingApiClient({ channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN }),
    logger,
  );

  const app = createApp({
    prisma,
    clock,
    lineGateway,
    idTokenVerifier: new LineIdTokenVerifier({ channelId: config.lineLoginChannelId }),
    config,
    logger,
  });

  const server: Server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'server listening');
  });

  const recurringScheduler = new RecurringScheduler({
    recurring: new RecurringService({ prisma, clock }),
    gateway: lineGateway,
    clock,
    ownerUserId: config.ownerUserId,
    liffId: config.liffId,
    logger,
  });
  recurringScheduler.start();

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    recurringScheduler.stop();

    const forceExit = setTimeout(() => {
      logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    // 停止接受新連線、等待進行中請求完成；閒置的 keep-alive 連線立即關閉
    server.close((closeError) => {
      disconnectPrismaClient()
        .catch((error: unknown) => logger.error({ err: error }, 'prisma disconnect failed'))
        .finally(() => {
          if (closeError) logger.error({ err: closeError }, 'server close failed');
          process.exit(closeError ? 1 : 0);
        });
    });
    server.closeIdleConnections();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
