/**
 * API 基礎層：Authorization、401 重試（R10）、violationType → 中文訊息。
 *
 * 執行：npm --prefix web test -- src/api/http.test.ts
 * 假設的模組介面（web/src/api/http.ts）：
 *   class ApiError extends Error {
 *     status: number;          // HTTP status；網路錯誤為 0
 *     violationType: ViolationType | 'NETWORK_ERROR' | 'SERVER_ERROR' | 'INVALID_RESPONSE';
 *     // message 一律為「中文對照表」文字，不直接顯示伺服器回傳的 message
 *   }
 *   request<T = void>(path, options?: {
 *     method?: 'GET' | 'POST' | 'PUT' | 'DELETE';   // 預設 GET
 *     query?: Record<string, string | undefined>;   // undefined 的值不帶入 query string
 *     body?: unknown;                               // JSON 序列化，Content-Type: application/json
 *     schema?: z.ZodType<T>;                        // 提供時以 zod 解析回應；204 回傳 undefined
 *   }): Promise<T>
 *   - 每次請求帶 Authorization: Bearer <liff-client.getIdToken()>
 *   - 回 401 → 呼叫 liff-client.login()，以新的 token 重送「同一個請求」一次；第二次仍 401 則拋 ApiError（R10）
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError, request } from './http';
import {
  delay,
  errorResponse,
  http,
  HttpResponse,
  requestLog,
  requestsTo,
  VALID_ID_TOKEN,
  type ViolationType,
} from '../test/mocks/handlers';
import { liffMock } from '../test/mocks/liff';
import { server } from '../test/mocks/server';

const listSchema = z.object({
  items: z.array(z.object({ id: z.number(), item: z.string() }).passthrough()),
});

async function catchError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('預期 request 應該失敗，但成功了');
}

describe('api/http / request', () => {
  describe('Smoke', () => {
    it('GET：帶 Bearer ID token 與 query，並以 schema 解析回應', async () => {
      const result = await request('/api/transactions', {
        query: { month: '2026-11', ledger: 'personal' },
        schema: listSchema,
      });

      expect(result.items.map((i) => i.id)).toEqual([11, 10, 12]);
      const [req] = requestsTo('GET', '/api/transactions');
      expect(req?.authorization).toBe(`Bearer ${VALID_ID_TOKEN}`);
      expect(req?.query).toEqual({ month: '2026-11', ledger: 'personal' });
    });
  });

  describe('Happy', () => {
    it('POST：以 JSON 送出 body 並解析 201 回應', async () => {
      const body = {
        ledger: 'personal',
        entryType: 'expense',
        item: '早餐',
        amount: 60,
        categoryId: 1,
        occurredOn: '2026-11-12',
        note: null,
      };

      const created = await request('/api/transactions', {
        method: 'POST',
        body,
        schema: z.object({ id: z.number(), item: z.string() }).passthrough(),
      });

      expect(created.item).toBe('早餐');
      const [req] = requestsTo('POST', '/api/transactions');
      expect(req?.body).toEqual(body);
    });

    it('DELETE 回 204 時回傳 undefined', async () => {
      await expect(request('/api/transactions/10', { method: 'DELETE' })).resolves.toBeUndefined();
    });

    it('query 中值為 undefined 的欄位不會帶入 URL', async () => {
      await request('/api/categories', {
        query: { ledger: 'personal', entryType: 'expense', extra: undefined },
      });

      expect(requestsTo('GET', '/api/categories')[0]?.query).toEqual({
        ledger: 'personal',
        entryType: 'expense',
      });
    });
  });

  describe('Error：violationType → 中文訊息（不顯示伺服器原文）', () => {
    const cases: Array<[ViolationType, number, string]> = [
      ['FORBIDDEN', 403, '您沒有使用此服務的權限'],
      ['INVALID_ARGUMENT', 400, '輸入的資料有誤，請檢查後再試'],
      ['NOT_FOUND', 404, '找不到指定的資料'],
      ['CATEGORY_MISMATCH', 400, '所選分類與帳本或收支不符，請重新選擇分類'],
      ['DUPLICATE_NAME', 409, '名稱重複'],
      ['FALLBACK_CATEGORY_UNDELETABLE', 422, '「其他」分類無法刪除'],
    ];

    it.each(cases)('%s（HTTP %i）→ %s', async (violationType, status, message) => {
      server.use(
        http.get('*/api/transactions', () =>
          errorResponse(status, violationType, 'raw english server message'),
        ),
      );

      const error = await catchError(
        request('/api/transactions', { query: { month: '2026-11', ledger: 'personal' } }),
      );

      expect(error.status).toBe(status);
      expect(error.violationType).toBe(violationType);
      expect(error.message).toBe(message);
      expect(error.message).not.toContain('raw english server message');
    });

    it('5xx 且回應不是 JSON → 「伺服器發生錯誤，請稍後再試」', async () => {
      server.use(
        http.get(
          '*/api/transactions',
          () => new HttpResponse('<html>Bad Gateway</html>', { status: 502 }),
        ),
      );

      const error = await catchError(request('/api/transactions'));

      expect(error.status).toBe(502);
      expect(error.violationType).toBe('SERVER_ERROR');
      expect(error.message).toBe('伺服器發生錯誤，請稍後再試');
    });

    it('網路錯誤 → NETWORK_ERROR 與「網路連線失敗，請檢查網路後再試」，且不觸發 login', async () => {
      server.use(http.get('*/api/transactions', () => HttpResponse.error()));

      const error = await catchError(request('/api/transactions'));

      expect(error.violationType).toBe('NETWORK_ERROR');
      expect(error.message).toBe('網路連線失敗，請檢查網路後再試');
      expect(liffMock.login).not.toHaveBeenCalled();
    });

    it('回應不符 schema → INVALID_RESPONSE', async () => {
      server.use(http.get('*/api/transactions', () => HttpResponse.json({ items: [{ id: 'x' }] })));

      const error = await catchError(request('/api/transactions', { schema: listSchema }));

      expect(error.violationType).toBe('INVALID_RESPONSE');
      expect(error.message).toBe('伺服器回應格式不正確');
    });

    it('ASM-12：503 且 violationType=UNAUTHENTICATED（LINE 驗證服務暫時不可用）→ 不呼叫 login、不重試', async () => {
      server.use(
        http.get('*/api/transactions', () =>
          errorResponse(503, 'UNAUTHENTICATED', 'LINE 驗證服務暫時無法使用'),
        ),
      );

      const error = await catchError(request('/api/transactions'));

      expect(error.status).toBe(503);
      expect(error.message).toBe('服務暫時無法使用，請稍後再試');
      expect(liffMock.login).not.toHaveBeenCalled();
      expect(requestsTo('GET', '/api/transactions')).toHaveLength(1);
    });
  });

  describe('R10：401 → liff.login 後重試一次', () => {
    /** 模擬「token 過期 → login → 取得新 token」：login 被呼叫後 getIDToken 回傳新 token。 */
    function expireTokenUntilLogin() {
      let token = 'expired-token';
      liffMock.getIDToken.mockImplementation(() => token);
      liffMock.login.mockImplementation(() => {
        token = VALID_ID_TOKEN;
      });
    }

    it('收到 401 → 呼叫 login 一次 → 以新 token 重送，最終成功', async () => {
      expireTokenUntilLogin();

      const result = await request('/api/transactions', {
        query: { month: '2026-11', ledger: 'personal' },
        schema: listSchema,
      });

      expect(result.items).toHaveLength(3);
      expect(liffMock.login).toHaveBeenCalledTimes(1);
      const calls = requestsTo('GET', '/api/transactions');
      expect(calls.map((c) => c.authorization)).toEqual([
        'Bearer expired-token',
        `Bearer ${VALID_ID_TOKEN}`,
      ]);
    });

    it('POST 重試時送出與原請求相同的 body', async () => {
      expireTokenUntilLogin();
      const body = {
        ledger: 'personal',
        entryType: 'expense',
        item: '午餐',
        amount: 120,
        categoryId: 1,
        occurredOn: '2026-11-12',
        note: null,
      };

      await request('/api/transactions', { method: 'POST', body });

      const calls = requestsTo('POST', '/api/transactions');
      expect(calls).toHaveLength(2);
      expect(calls[0]?.body).toEqual(body);
      expect(calls[1]?.body).toEqual(body);
    });

    it('重試後仍 401：只重試一次、login 只呼叫一次，拋出 UNAUTHENTICATED 中文訊息', async () => {
      liffMock.getIDToken.mockReturnValue('always-bad-token');

      const error = await catchError(
        request('/api/transactions', { query: { month: '2026-11', ledger: 'personal' } }),
      );

      expect(error.status).toBe(401);
      expect(error.violationType).toBe('UNAUTHENTICATED');
      expect(error.message).toBe('登入已失效，請重新開啟頁面');
      expect(liffMock.login).toHaveBeenCalledTimes(1);
      expect(requestsTo('GET', '/api/transactions')).toHaveLength(2);
    });

    it('非 401 的錯誤（403）不呼叫 login、不重試', async () => {
      server.use(http.get('*/api/transactions', () => errorResponse(403, 'FORBIDDEN')));

      await catchError(request('/api/transactions'));

      expect(liffMock.login).not.toHaveBeenCalled();
      expect(requestsTo('GET', '/api/transactions')).toHaveLength(1);
    });

    it('一般成功請求不會呼叫 login', async () => {
      await request('/api/transactions', { query: { month: '2026-11', ledger: 'personal' } });

      expect(liffMock.login).not.toHaveBeenCalled();
      expect(requestLog).toHaveLength(1);
    });

    it('同時兩個請求都收到 401：各自重試一次，不會無限迴圈', async () => {
      expireTokenUntilLogin();
      server.use(
        http.get('*/api/categories', async ({ request: req }) => {
          if (req.headers.get('authorization') !== `Bearer ${VALID_ID_TOKEN}`) {
            await delay(5);
            return errorResponse(401, 'UNAUTHENTICATED');
          }
          return HttpResponse.json({ items: [] });
        }),
      );

      await Promise.all([
        request('/api/transactions', { query: { month: '2026-11', ledger: 'personal' } }),
        request('/api/categories', { query: { ledger: 'personal', entryType: 'expense' } }),
      ]);

      expect(requestsTo('GET', '/api/transactions').length).toBeLessThanOrEqual(2);
      expect(requestsTo('GET', '/api/categories').length).toBeLessThanOrEqual(2);
    });
  });
});
