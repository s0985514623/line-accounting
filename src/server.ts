/**
 * 進入點：讀 env → 建立 deps → listen → graceful shutdown（SIGTERM / SIGINT）。
 */
import type { Server } from 'node:http';
import { messagingApi } from '@line/bot-sdk';
import { LineMessagingGateway } from './adapters/line-messaging-gateway';
import { SystemClock } from './adapters/system-clock';
import { createApp } from './app';
import { EnvValidationError, loadEnv, toAppConfig } from './config/env';
import { disconnectPrismaClient, getPrismaClient } from './db/prisma';
import { createLogger } from './logging/logger';
import type { IdTokenVerifier } from './ports/id-token-verifier';

/** 等待進行中請求的上限；逾時強制結束。 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

// LIFF 驗證尚無真實 adapter（P6：line-id-token-verifier）。在接上之前明確失敗，避免靜默放行。
const pendingIdTokenVerifier: IdTokenVerifier = {
  verify: async () => {
    throw new Error('ID token verifier 尚未實作（P6）');
  },
};

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

  const app = createApp({
    prisma,
    clock: new SystemClock(),
    lineGateway: new LineMessagingGateway(
      new messagingApi.MessagingApiClient({ channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN }),
      logger,
    ),
    idTokenVerifier: pendingIdTokenVerifier,
    config,
    logger,
  });

  const server: Server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'server listening');
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

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
