/**
 * LINE Login ID token 驗證 adapter（implementation-plan P6-1、ASM-12）。
 *
 *  - POST https://api.line.me/oauth2/v2.1/verify（x-www-form-urlencoded：id_token、client_id）
 *  - 逾時預設 3 秒（AbortSignal 中止）
 *  - 200 → { sub }，並以 token 的 SHA-256 為 key 快取到 exp（epoch 秒）；上限預設 500 筆，滿時淘汰最舊
 *  - 400 → InvalidTokenError（過期、簽章錯、client_id 不符）
 *  - 其他非 2xx / 逾時 / 網路錯誤 / 回應格式不符 → VerifierUnavailableError
 *  - 失敗結果一律不快取
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Clock } from '../ports/clock';
import {
  InvalidTokenError,
  VerifierUnavailableError,
  type IdTokenVerifier,
  type VerifiedIdToken,
} from '../ports/id-token-verifier';

export const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_CACHE_ENTRIES = 500;

export interface LineIdTokenVerifierOptions {
  /** LINE Login channel ID（LINE_LOGIN_CHANNEL_ID）→ form 欄位 client_id */
  channelId: string;
  /** 預設 globalThis.fetch */
  fetch?: typeof fetch;
  /** 快取到期判斷用；預設系統時間 */
  clock?: Clock;
  /** 預設 3000 */
  timeoutMs?: number;
  /** 預設 500 */
  maxCacheEntries?: number;
}

/** LINE verify 成功回應中本服務需要的欄位。 */
const VerifyResponseSchema = z.object({
  sub: z.string().min(1),
  exp: z.number().finite().optional(),
});

interface CacheEntry {
  sub: string;
  /** epoch 毫秒 */
  expiresAt: number;
}

const systemClock: Clock = { now: () => new Date() };

export class LineIdTokenVerifier implements IdTokenVerifier {
  private readonly channelId: string;
  private readonly fetchFn: typeof fetch;
  private readonly clock: Clock;
  private readonly timeoutMs: number;
  private readonly maxCacheEntries: number;
  /** Map 保留插入順序：第一個 key 即最舊的項目。 */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: LineIdTokenVerifierOptions) {
    this.channelId = options.channelId;
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.clock = options.clock ?? systemClock;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
  }

  /**
   * 驗證 ID token。
   * @throws InvalidTokenError LINE 判定 token 無效（HTTP 400）
   * @throws VerifierUnavailableError 逾時、5xx、網路錯誤或回應格式不符
   */
  async verify(idToken: string): Promise<VerifiedIdToken> {
    const key = cacheKey(idToken);
    const cached = this.readCache(key);
    if (cached) return { sub: cached };

    const payload = await this.requestVerify(idToken);
    if (payload.exp !== undefined) this.writeCache(key, payload.sub, payload.exp * 1000);
    return { sub: payload.sub };
  }

  private async requestVerify(idToken: string): Promise<z.infer<typeof VerifyResponseSchema>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(LINE_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: idToken, client_id: this.channelId }).toString(),
        signal: controller.signal,
      });

      if (response.status === 400) throw new InvalidTokenError();
      if (!response.ok) {
        throw new VerifierUnavailableError(`LINE verify 回應 HTTP ${response.status}`);
      }

      const parsed = VerifyResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new VerifierUnavailableError('LINE verify 回應格式不符');
      return parsed.data;
    } catch (error) {
      if (error instanceof InvalidTokenError || error instanceof VerifierUnavailableError) {
        throw error;
      }
      // 逾時（AbortError）、網路錯誤、JSON 解析失敗
      throw new VerifierUnavailableError(undefined, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  private readCache(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.clock.now().getTime()) {
      this.cache.delete(key);
      return null;
    }
    return entry.sub;
  }

  private writeCache(key: string, sub: string, expiresAt: number): void {
    if (expiresAt <= this.clock.now().getTime()) return;
    this.cache.delete(key);
    while (this.cache.size >= this.maxCacheEntries) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
    this.cache.set(key, { sub, expiresAt });
  }
}

/** 快取 key 用 token 的 SHA-256，記憶體中不保留原始 token。 */
function cacheKey(idToken: string): string {
  return createHash('sha256').update(idToken).digest('hex');
}
