/**
 * Express 錯誤處理（最後一個 middleware）。
 *  - DomainError → { message, violationType } + 對應 HTTP 狀態（specs/api/api.yml）
 *  - JSON body 解析失敗 → 400 INVALID_ARGUMENT
 *  - 其他 → 500 { message: '系統錯誤' }，不洩漏 stack / 內部細節，log error
 */
import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';
import { isDomainError, type ViolationType } from '../../domain/errors';

export const HTTP_STATUS_BY_VIOLATION: Readonly<Record<ViolationType, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  INVALID_ARGUMENT: 400,
  CATEGORY_MISMATCH: 400,
  NOT_FOUND: 404,
  DUPLICATE_NAME: 409,
  FALLBACK_CATEGORY_UNDELETABLE: 422,
  OCCURRENCE_RESOLVED: 409,
};

export const INTERNAL_ERROR_MESSAGE = '系統錯誤';

/** body-parser 解析失敗時的錯誤形狀。 */
function isBodyParseError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: unknown }).type === 'entity.parse.failed'
  );
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (isDomainError(error)) {
      res.status(HTTP_STATUS_BY_VIOLATION[error.violationType]).json({
        message: error.message,
        violationType: error.violationType,
      });
      return;
    }

    if (isBodyParseError(error)) {
      res
        .status(400)
        .json({ message: '請求內容不是合法的 JSON', violationType: 'INVALID_ARGUMENT' });
      return;
    }

    logger.error({ err: error }, 'unhandled error');
    res.status(500).json({ message: INTERNAL_ERROR_MESSAGE });
  };
}
