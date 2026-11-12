/**
 * 單元測試：LINE ID token 驗證 adapter（以注入的 fetch 取代網路）
 *
 * 執行：npx vitest run tests/unit/adapters/line-id-token-verifier.test.ts
 *
 * 契約（nodejs-master 請遵循；依據 implementation-plan P6-1、ASM-12）：
 *   - src/adapters/line-id-token-verifier.ts
 *       export class LineIdTokenVerifier implements IdTokenVerifier {
 *         constructor(options: {
 *           channelId: string;               // LINE_LOGIN_CHANNEL_ID → form 欄位 client_id
 *           fetch?: typeof fetch;            // 預設 globalThis.fetch
 *           clock?: Clock;                   // 預設系統時間（快取到 exp 的判斷）
 *           timeoutMs?: number;              // 預設 3000
 *           maxCacheEntries?: number;        // 預設 500
 *         });
 *         verify(idToken: string): Promise<{ sub: string }>;
 *       }
 *   - src/ports/id-token-verifier.ts 新增 `export class VerifierUnavailableError extends Error`
 *       （建構子可不帶參數；LINE 逾時 / 5xx / 網路錯誤時拋出，→ HTTP 503）。
 *   - 請求：POST https://api.line.me/oauth2/v2.1/verify，Content-Type application/x-www-form-urlencoded，
 *       body 欄位 id_token、client_id。
 *   - 回應：200 → 取 JSON 的 sub（快取到 exp，以秒為單位的 epoch）；400 → InvalidTokenError；
 *       5xx / 逾時 / fetch 拋錯 → VerifierUnavailableError。失敗結果不快取。
 *   - 快取上限 500 筆；超過時淘汰最舊的（本測試只假設「最舊先淘汰、最新保留」）。
 */
import { describe, expect, it, vi } from 'vitest';
import { LineIdTokenVerifier } from '../../../src/adapters/line-id-token-verifier';
import { InvalidTokenError, VerifierUnavailableError } from '../../../src/ports/id-token-verifier';
import { FixedClock } from '../../bdd/support/stubs';

const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const CHANNEL_ID = '1234567890';
const SUB = 'U0123456789abcdef0123456789abcdef';

type FetchArgs = [input: string | URL | Request, init?: RequestInit];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function okBody(clock: FixedClock, overrides: Record<string, unknown> = {}) {
  const nowSeconds = Math.floor(clock.now().getTime() / 1000);
  return {
    iss: 'https://access.line.me',
    sub: SUB,
    aud: CHANNEL_ID,
    exp: nowSeconds + 3600,
    iat: nowSeconds,
    ...overrides,
  };
}

/** 建立 fetch 替身，並回傳呼叫紀錄。 */
function stubFetch(handler: (...args: FetchArgs) => Promise<Response> | Response) {
  const fn = vi.fn(async (...args: FetchArgs) => handler(...args));
  return { fn, fetch: fn as unknown as typeof fetch };
}

function formOf(init: RequestInit | undefined): URLSearchParams {
  return new URLSearchParams(String(init?.body ?? ''));
}

describe('[Smoke] 驗證成功', () => {
  it('200 → 回傳 { sub }，請求為 POST 到 LINE verify endpoint', async () => {
    const clock = new FixedClock();
    const { fn, fetch } = stubFetch(() => jsonResponse(200, okBody(clock)));
    const verifier = new LineIdTokenVerifier({ channelId: CHANNEL_ID, fetch, clock });

    await expect(verifier.verify('token-a')).resolves.toEqual({ sub: SUB });

    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0] as FetchArgs;
    expect(String(url)).toBe(VERIFY_URL);
    expect(init?.method).toBe('POST');
  });
});

describe('[Happy] 請求格式', () => {
  it('Content-Type 為 application/x-www-form-urlencoded，欄位 id_token 與 client_id=LINE_LOGIN_CHANNEL_ID', async () => {
    const clock = new FixedClock();
    const { fn, fetch } = stubFetch(() => jsonResponse(200, okBody(clock)));
    const verifier = new LineIdTokenVerifier({ channelId: CHANNEL_ID, fetch, clock });

    await verifier.verify('token-a');

    const [, init] = fn.mock.calls[0] as FetchArgs;
    expect(new Headers(init?.headers).get('content-type')).toContain(
      'application/x-www-form-urlencoded',
    );
    const form = formOf(init);
    expect(form.get('id_token')).toBe('token-a');
    expect(form.get('client_id')).toBe(CHANNEL_ID);
    expect([...form.keys()].sort()).toEqual(['client_id', 'id_token']);
  });

  it('提供 AbortSignal（供逾時中止）', async () => {
    const clock = new FixedClock();
    const { fn, fetch } = stubFetch(() => jsonResponse(200, okBody(clock)));
    await new LineIdTokenVerifier({ channelId: CHANNEL_ID, fetch, clock }).verify('token-a');

    const [, init] = fn.mock.calls[0] as FetchArgs;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('[Error] LINE 回應錯誤', () => {
  it('400（過期 / 簽章錯 / client_id 不符）→ InvalidTokenError', async () => {
    const { fetch } = stubFetch(() =>
      jsonResponse(400, { error: 'invalid_request', error_description: 'IdToken expired.' }),
    );
    const verifier = new LineIdTokenVerifier({ channelId: CHANNEL_ID, fetch });

    await expect(verifier.verify('expired')).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it.each([500, 502, 503, 504])('%i → VerifierUnavailableError', async (status) => {
    const { fetch } = stubFetch(() => jsonResponse(status, { error: 'server_error' }));
    const verifier = new LineIdTokenVerifier({ channelId: CHANNEL_ID, fetch });

    await expect(verifier.verify('token-a')).rejects.toBeInstanceOf(VerifierUnavailableError);
  });

  it('網路錯誤（fetch 拋出）→ VerifierUnavailableError，而非 InvalidTokenError', async () => {
    const { fetch } = stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    const verifier = new LineIdTokenVerifier({ channelId: CHANNEL_ID, fetch });

    const error = await verifier.verify('token-a').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VerifierUnavailableError);
    expect(error).not.toBeInstanceOf(InvalidTokenError);
  });

  it('失敗結果不快取：400 之後同 token 會再次呼叫 LINE', async () => {
    const clock = new FixedClock();
    let call = 0;
    const { fn, fetch } = stubFetch(() =>
      ++call === 1
        ? jsonResponse(400, { error: 'invalid_request' })
        : jsonResponse(200, okBody(clock)),
    );
    const verifier = new LineIdTokenVerifier({ channelId: CHANNEL_ID, fetch, clock });

    await expect(verifier.verify('token-a')).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(verifier.verify('token-a')).resolves.toEqual({ sub: SUB });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('失敗結果不快取：5xx 之後同 token 會再次呼叫 LINE', async () => {
    const clock = new FixedClock();
    let call = 0;
    const { fn, fetch } = stubFetch(() =>
      ++call === 1 ? jsonResponse(503, {}) : jsonResponse(200, okBody(clock)),
    );
    const verifier = new LineIdTokenVerifier({ channelId: CHANNEL_ID, fetch, clock });

    await expect(verifier.verify('token-a')).rejects.toBeInstanceOf(VerifierUnavailableError);
    await expect(verifier.verify('token-a')).resolves.toEqual({ sub: SUB });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('[Edge] 逾時 3 秒', () => {
  it('LINE 久未回應 → 約 3 秒後以 VerifierUnavailableError 失敗', async () => {
    // fetch 替身：遵守 AbortSignal，永不自行回應（真實 fetch 同樣會在 abort 時拋出）
    const { fetch } = stubFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    const verifier = new LineIdTokenVerifier({ channelId: CHANNEL_ID, fetch });

    const startedAt = Date.now();
    await expect(verifier.verify('token-slow')).rejects.toBeInstanceOf(VerifierUnavailableError);
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeGreaterThanOrEqual(2_900);
    expect(elapsed).toBeLessThan(4_500);
  });
});

describe('[Edge] 成功結果快取', () => {
  it('同 token 在 exp 之前再次驗證 → 不再呼叫 LINE', async () => {
    const clock = new FixedClock();
    const { fn, fetch } = stubFetch(() => jsonResponse(200, okBody(clock)));
    const verifier = new LineIdTokenVerifier({ channelId: CHANNEL_ID, fetch, clock });

    await verifier.verify('token-a');
    await expect(verifier.verify('token-a')).resolves.toEqual({ sub: SUB });

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('不同 token 各自驗證、各自快取（sub 不互相污染）', async () => {
    const clock = new FixedClock();
    const subByToken: Record<string, string> = { 'token-a': 'U-a', 'token-b': 'U-b' };
    const { fn, fetch } = stubFetch((_input, init) => {
      const token = formOf(init).get('id_token') ?? '';
      return jsonResponse(200, okBody(clock, { sub: subByToken[token] }));
    });
    const verifier = new LineIdTokenVerifier({ channelId: CHANNEL_ID, fetch, clock });

    await expect(verifier.verify('token-a')).resolves.toEqual({ sub: 'U-a' });
    await expect(verifier.verify('token-b')).resolves.toEqual({ sub: 'U-b' });
    await expect(verifier.verify('token-a')).resolves.toEqual({ sub: 'U-a' });
    await expect(verifier.verify('token-b')).resolves.toEqual({ sub: 'U-b' });

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('時間越過 exp 之後 → 快取失效，重新呼叫 LINE', async () => {
    const clock = new FixedClock('2026-11-12');
    const { fn, fetch } = stubFetch(() => jsonResponse(200, okBody(clock))); // exp = 當下 + 3600 秒
    const verifier = new LineIdTokenVerifier({ channelId: CHANNEL_ID, fetch, clock });

    await verifier.verify('token-a');
    clock.set('2026-11-13'); // +24 小時，遠超過 exp
    await verifier.verify('token-a');

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('快取上限 500 筆：驗證 501 個不同 token 後，最舊的被淘汰、最新的仍在快取', async () => {
    const clock = new FixedClock();
    const { fn, fetch } = stubFetch(() => jsonResponse(200, okBody(clock)));
    const verifier = new LineIdTokenVerifier({ channelId: CHANNEL_ID, fetch, clock });

    for (let i = 0; i < 501; i++) {
      await verifier.verify(`token-${i}`);
    }
    expect(fn).toHaveBeenCalledTimes(501);

    await verifier.verify('token-500'); // 最新：命中快取
    expect(fn).toHaveBeenCalledTimes(501);

    await verifier.verify('token-0'); // 最舊：已被淘汰，需重新呼叫 LINE
    expect(fn).toHaveBeenCalledTimes(502);
  });

  it('快取上限 500 筆：恰好 500 個不同 token 全部留在快取', async () => {
    const clock = new FixedClock();
    const { fn, fetch } = stubFetch(() => jsonResponse(200, okBody(clock)));
    const verifier = new LineIdTokenVerifier({ channelId: CHANNEL_ID, fetch, clock });

    for (let i = 0; i < 500; i++) {
      await verifier.verify(`token-${i}`);
    }
    await verifier.verify('token-0');
    await verifier.verify('token-499');

    expect(fn).toHaveBeenCalledTimes(500);
  });
});
