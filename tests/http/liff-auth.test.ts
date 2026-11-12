/**
 * HTTP 測試：LIFF 驗證 middleware（src/http/middleware/liff-auth.ts），以 /api/categories 為代表路由
 *
 * 執行：TEST_DATABASE_URL=postgresql://test:test@localhost:5434/test npx vitest run tests/http/liff-auth.test.ts
 *
 * 契約（nodejs-master 請遵循；依據 implementation-plan P6-2、錯誤處理登記表 liff-auth 三列、ASM-12、specs/api/api.yml）：
 *   - 所有 /api/* 路由先經 liff-auth：
 *       無 Authorization 或非 `Bearer <token>`           → 401 { message, violationType: 'UNAUTHENTICATED' }，不呼叫 verifier
 *       verifier 拋 InvalidTokenError                     → 401 UNAUTHENTICATED
 *       verifier 拋 VerifierUnavailableError（逾時 / 5xx） → 503 { message: 'LINE 驗證服務暫時無法使用', violationType: 'UNAUTHENTICATED' }
 *       verifier 回傳 sub ≠ config.ownerUserId            → 403 { message, violationType: 'FORBIDDEN' }
 *   - 傳給 verifier 的是 Bearer 後面的 token 本身（不含 "Bearer "）。
 *   - 驗證失敗的請求不得產生任何資料副作用。
 *   - src/ports/id-token-verifier.ts 匯出 VerifierUnavailableError；
 *     src/adapters/line-id-token-verifier.ts 匯出 LineIdTokenVerifier（選項見 tests/unit/adapters/line-id-token-verifier.test.ts）。
 *   - 「同 token 第二次不呼叫 verifier」：快取位於 adapter（P6-1），故以真實 LineIdTokenVerifier + 注入 fetch 驗證
 *     「第二次請求不會再呼叫 LINE verify endpoint」。
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as port from '../../src/ports/id-token-verifier';
import { insertWithIds } from '../bdd/support/db';
import type { StubIdTokenVerifier } from '../bdd/support/stubs';
import { createWebhookHarness, type WebhookHarness } from './support/webhook-harness';

const OWNER = 'U-owner';
const LOGIN_CHANNEL = 'test-login-channel';
const UNAVAILABLE_MESSAGE = 'LINE 驗證服務暫時無法使用';
const LIST_URL = '/api/categories?ledger=personal&entryType=expense';

let harness: WebhookHarness;

beforeAll(async () => {
  harness = await createWebhookHarness();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
});

// ---- 輔助 ---------------------------------------------------------------------------------

/** 可替換行為、記錄呼叫的 verifier 替身（結構符合 IdTokenVerifier）。 */
function recordingVerifier(behavior: (token: string) => Promise<{ sub: string }>) {
  const verify = vi.fn(behavior);
  return { verify, verifier: { verify } as unknown as StubIdTokenVerifier };
}

function unavailableError(): Error {
  if (typeof port.VerifierUnavailableError !== 'function') {
    throw new Error('src/ports/id-token-verifier.ts 尚未匯出 VerifierUnavailableError');
  }
  return new port.VerifierUnavailableError();
}

/** 真實 adapter + 注入 fetch（動態載入：adapter 尚未實作時只讓用到它的測試失敗）。 */
async function realVerifier(fetchStub: ReturnType<typeof vi.fn>): Promise<StubIdTokenVerifier> {
  const { LineIdTokenVerifier } = await import('../../src/adapters/line-id-token-verifier.js');
  return new LineIdTokenVerifier({
    channelId: LOGIN_CHANNEL,
    fetch: fetchStub as unknown as typeof fetch,
  }) as unknown as StubIdTokenVerifier;
}

async function seedCategories(): Promise<void> {
  await insertWithIds(harness.prisma, 'categories', [
    { id: 1, ledger: 'personal', entry_type: 'expense', name: '餐飲', is_fallback: false },
    { id: 2, ledger: 'personal', entry_type: 'expense', name: '其他', is_fallback: true },
  ]);
}

function expectErrorShape(body: unknown, violationType: string): void {
  expect(body).toEqual({ message: expect.any(String), violationType });
  expect((body as { message: string }).message.length).toBeGreaterThan(0);
}

// ---- 測試 ---------------------------------------------------------------------------------

describe('[Smoke] 合法請求', () => {
  it('verifier 回傳白名單 sub → 200，且 verifier 收到的是 token 本身（不含 Bearer）', async () => {
    await seedCategories();
    const { verify, verifier } = recordingVerifier(async () => ({ sub: OWNER }));
    const { app } = harness.makeApp({ idToken: verifier, ownerUserId: OWNER });

    const response = await request(app).get(LIST_URL).set('Authorization', 'Bearer abc.def.ghi');

    expect(response.status).toBe(200);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith('abc.def.ghi');
  });
});

describe('[Error] 缺少或格式錯誤的 Authorization → 401', () => {
  it.each([
    ['沒有 Authorization header', undefined],
    ['空字串', ''],
    ['只有 Bearer 沒有 token', 'Bearer '],
    ['Bearer 後面只有空白', 'Bearer    '],
    ['Basic 方案', 'Basic dXNlcjpwYXNz'],
    ['沒有方案的裸 token', 'abc.def.ghi'],
  ])('%s', async (_name, header) => {
    const { verify, verifier } = recordingVerifier(async () => ({ sub: OWNER }));
    const { app } = harness.makeApp({ idToken: verifier, ownerUserId: OWNER });

    const req = request(app).get(LIST_URL);
    const response = header === undefined ? await req : await req.set('Authorization', header);

    expect(response.status).toBe(401);
    expectErrorShape(response.body, 'UNAUTHENTICATED');
    expect(verify).not.toHaveBeenCalled();
  });

  it('POST /api/categories 無 Authorization → 401，且不建立分類', async () => {
    const { app } = harness.makeApp({
      idToken: recordingVerifier(async () => ({ sub: OWNER })).verifier,
      ownerUserId: OWNER,
    });

    const response = await request(app)
      .post('/api/categories')
      .send({ ledger: 'personal', entryType: 'expense', name: '寵物' });

    expect(response.status).toBe(401);
    expectErrorShape(response.body, 'UNAUTHENTICATED');
    expect(await harness.countRows('categories')).toBe(0);
  });

  it('DELETE /api/categories/{id} 無 Authorization → 401，且分類不被刪除', async () => {
    await seedCategories();
    const { app } = harness.makeApp({
      idToken: recordingVerifier(async () => ({ sub: OWNER })).verifier,
      ownerUserId: OWNER,
    });

    const response = await request(app).delete('/api/categories/1');

    expect(response.status).toBe(401);
    expectErrorShape(response.body, 'UNAUTHENTICATED');
    expect(await harness.countRows('categories')).toBe(2);
  });
});

describe('[Error] verifier 判定 token 無效 → 401', () => {
  it('verifier 拋出 InvalidTokenError → 401 UNAUTHENTICATED', async () => {
    const { verifier } = recordingVerifier(async () => {
      throw new port.InvalidTokenError();
    });
    const { app } = harness.makeApp({ idToken: verifier, ownerUserId: OWNER });

    const response = await request(app).get(LIST_URL).set('Authorization', 'Bearer expired');

    expect(response.status).toBe(401);
    expectErrorShape(response.body, 'UNAUTHENTICATED');
  });
});

describe('[Error] LINE 驗證服務逾時 / 5xx → 503（ASM-12）', () => {
  it('verifier 拋出 VerifierUnavailableError → 503，violationType 仍為 UNAUTHENTICATED，訊息為固定中文', async () => {
    const { verifier } = recordingVerifier(async () => {
      throw unavailableError();
    });
    const { app } = harness.makeApp({ idToken: verifier, ownerUserId: OWNER });

    const response = await request(app).get(LIST_URL).set('Authorization', 'Bearer abc');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      message: UNAVAILABLE_MESSAGE,
      violationType: 'UNAUTHENTICATED',
    });
  });

  it('503 與 401 可區分（前端據此決定「重試」或「重新登入」）', async () => {
    const { verifier } = recordingVerifier(async () => {
      throw unavailableError();
    });
    const { app } = harness.makeApp({ idToken: verifier, ownerUserId: OWNER });

    const unavailable = await request(app).get(LIST_URL).set('Authorization', 'Bearer abc');
    const missing = await request(app).get(LIST_URL);

    expect(unavailable.status).toBe(503);
    expect(missing.status).toBe(401);
  });

  it('真實 adapter：LINE verify 回 503 → API 回 503', async () => {
    const fetchStub = vi.fn(async () => new Response('{}', { status: 503 }));
    const { app } = harness.makeApp({
      idToken: await realVerifier(fetchStub),
      ownerUserId: OWNER,
    });

    const response = await request(app).get(LIST_URL).set('Authorization', 'Bearer abc');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      message: UNAVAILABLE_MESSAGE,
      violationType: 'UNAUTHENTICATED',
    });
  });

  it('真實 adapter：LINE verify 回 400 → API 回 401', async () => {
    const fetchStub = vi.fn(
      async () => new Response('{"error":"invalid_request"}', { status: 400 }),
    );
    const { app } = harness.makeApp({
      idToken: await realVerifier(fetchStub),
      ownerUserId: OWNER,
    });

    const response = await request(app).get(LIST_URL).set('Authorization', 'Bearer abc');

    expect(response.status).toBe(401);
    expectErrorShape(response.body, 'UNAUTHENTICATED');
  });
});

describe('[Security] sub 不在白名單 → 403', () => {
  it('GET：verifier 回傳他人 sub → 403 FORBIDDEN，且不洩漏分類資料', async () => {
    await seedCategories();
    const { verifier } = recordingVerifier(async () => ({ sub: 'U-stranger' }));
    const { app } = harness.makeApp({ idToken: verifier, ownerUserId: OWNER });

    const response = await request(app).get(LIST_URL).set('Authorization', 'Bearer abc');

    expect(response.status).toBe(403);
    expectErrorShape(response.body, 'FORBIDDEN');
    expect(response.body).not.toHaveProperty('items');
  });

  it('POST：他人 sub → 403，且不建立分類', async () => {
    const { verifier } = recordingVerifier(async () => ({ sub: 'U-stranger' }));
    const { app } = harness.makeApp({ idToken: verifier, ownerUserId: OWNER });

    const response = await request(app)
      .post('/api/categories')
      .set('Authorization', 'Bearer abc')
      .send({ ledger: 'personal', entryType: 'expense', name: '寵物' });

    expect(response.status).toBe(403);
    expectErrorShape(response.body, 'FORBIDDEN');
    expect(await harness.countRows('categories')).toBe(0);
  });

  it('DELETE：他人 sub → 403，且分類不被刪除', async () => {
    await seedCategories();
    const { verifier } = recordingVerifier(async () => ({ sub: 'U-stranger' }));
    const { app } = harness.makeApp({ idToken: verifier, ownerUserId: OWNER });

    const response = await request(app)
      .delete('/api/categories/1')
      .set('Authorization', 'Bearer abc');

    expect(response.status).toBe(403);
    expectErrorShape(response.body, 'FORBIDDEN');
    expect(await harness.countRows('categories')).toBe(2);
  });

  it.each([
    ['大小寫相異的 userId', 'u-owner'],
    ['前後多空白的 userId', ' U-owner '],
    ['空字串 sub', ''],
  ])('白名單比對為精確相等：%s → 403', async (_name, sub) => {
    const { verifier } = recordingVerifier(async () => ({ sub }));
    const { app } = harness.makeApp({ idToken: verifier, ownerUserId: OWNER });

    const response = await request(app).get(LIST_URL).set('Authorization', 'Bearer abc');

    expect(response.status).toBe(403);
    expectErrorShape(response.body, 'FORBIDDEN');
  });
});

describe('[Edge] 同一 token 的快取', () => {
  it('同 token 第二次請求不會再呼叫 LINE verify endpoint，且兩次皆 200', async () => {
    await seedCategories();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const fetchStub = vi.fn(
      async () =>
        new Response(JSON.stringify({ sub: OWNER, exp, aud: LOGIN_CHANNEL }), { status: 200 }),
    );
    const { app } = harness.makeApp({
      idToken: await realVerifier(fetchStub),
      ownerUserId: OWNER,
    });

    const first = await request(app).get(LIST_URL).set('Authorization', 'Bearer same-token');
    const second = await request(app).get(LIST_URL).set('Authorization', 'Bearer same-token');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('不同 token 不共用快取：各自呼叫一次 LINE verify endpoint', async () => {
    await seedCategories();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const fetchStub = vi.fn(
      async () => new Response(JSON.stringify({ sub: OWNER, exp }), { status: 200 }),
    );
    const { app } = harness.makeApp({
      idToken: await realVerifier(fetchStub),
      ownerUserId: OWNER,
    });

    await request(app).get(LIST_URL).set('Authorization', 'Bearer token-1');
    await request(app).get(LIST_URL).set('Authorization', 'Bearer token-2');

    expect(fetchStub).toHaveBeenCalledTimes(2);
  });
});
