/**
 * LIFF 驗證 middleware（implementation-plan P6-2、錯誤處理登記表 liff-auth、ASM-12）。
 *
 *  - 無 Authorization / 非 `Bearer <token>` → 401 UNAUTHENTICATED（不呼叫 verifier）
 *  - verifier 拋 InvalidTokenError          → 401 UNAUTHENTICATED
 *  - verifier 拋 VerifierUnavailableError   → 503 { message: 'LINE 驗證服務暫時無法使用', violationType: 'UNAUTHENTICATED' }
 *  - sub 與白名單不完全相等                  → 403 FORBIDDEN
 *  - 通過 → res.locals.liffUserId = sub
 */
import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import { DomainError } from '../../domain/errors';
import {
  InvalidTokenError,
  VerifierUnavailableError,
  type IdTokenVerifier,
} from '../../ports/id-token-verifier';
import { asyncHandler } from '../async-handler';

export const VERIFIER_UNAVAILABLE_MESSAGE = 'LINE 驗證服務暫時無法使用';
const UNAUTHENTICATED_MESSAGE = '請重新登入';
const FORBIDDEN_MESSAGE = '此帳號沒有使用權限';

/** `Bearer <token>`（方案不分大小寫）；token 不可含空白。 */
const BEARER_PATTERN = /^Bearer +(\S+) *$/i;

export interface LiffAuthDeps {
  verifier: IdTokenVerifier;
  ownerUserId: string;
  logger: Logger;
}

/** 取出 Bearer token；缺少或格式錯誤回 null。 */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  return BEARER_PATTERN.exec(header)?.[1] ?? null;
}

export function createLiffAuth(deps: LiffAuthDeps): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const token = extractBearerToken(req.headers.authorization);
    if (token === null) {
      throw new DomainError('UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE);
    }

    let sub: string;
    try {
      ({ sub } = await deps.verifier.verify(token));
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw new DomainError('UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE);
      }
      if (error instanceof VerifierUnavailableError) {
        deps.logger.warn({ err: error }, 'liff-auth: LINE verify unavailable');
        res.status(503).json({
          message: VERIFIER_UNAVAILABLE_MESSAGE,
          violationType: 'UNAUTHENTICATED',
        });
        return;
      }
      throw error;
    }

    if (sub !== deps.ownerUserId) {
      deps.logger.warn('liff-auth: userId not in allowlist');
      throw new DomainError('FORBIDDEN', FORBIDDEN_MESSAGE);
    }

    res.locals.liffUserId = sub;
    next();
  });
}
