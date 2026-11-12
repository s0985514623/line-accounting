/**
 * HTTP 請求日誌（pino-http）。遮蔽規則由傳入的 logger（createLogger）負責。
 */
import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

/** 健康檢查頻繁且無診斷價值，不記錄。 */
const IGNORED_PATHS = new Set(['/healthz']);

export function createRequestLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    autoLogging: { ignore: (req) => IGNORED_PATHS.has(req.url ?? '') },
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  });
}
