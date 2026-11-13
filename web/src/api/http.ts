/**
 * API 基礎層：
 * - 每次請求帶 Authorization: Bearer <LIFF ID token>
 * - 401 → liff login 後以新 token 重送「同一個請求」一次（R10）
 * - 錯誤一律轉為 ApiError，message 取自中文對照表（不顯示伺服器原文）
 */
import type { z } from 'zod';
import { getIdToken, login } from '../liff/liff-client';
import { violationTypeSchema, type TViolationType } from './schemas';

export type TClientErrorType = 'NETWORK_ERROR' | 'SERVER_ERROR' | 'INVALID_RESPONSE';
export type TApiErrorType = TViolationType | TClientErrorType;

/** violationType → 使用者看得到的中文訊息。 */
export const ERROR_MESSAGES: Record<TApiErrorType, string> = {
  UNAUTHENTICATED: '登入已失效，請重新開啟頁面',
  FORBIDDEN: '您沒有使用此服務的權限',
  INVALID_ARGUMENT: '輸入的資料有誤，請檢查後再試',
  NOT_FOUND: '找不到指定的資料',
  CATEGORY_MISMATCH: '所選分類與帳本或收支不符，請重新選擇分類',
  DUPLICATE_NAME: '名稱重複',
  FALLBACK_CATEGORY_UNDELETABLE: '「其他」分類無法刪除',
  OCCURRENCE_RESOLVED: '此期已處理過（已入帳或已略過）',
  NETWORK_ERROR: '網路連線失敗，請檢查網路後再試',
  SERVER_ERROR: '伺服器發生錯誤，請稍後再試',
  INVALID_RESPONSE: '伺服器回應格式不正確',
};

/** 503（例如 LINE 驗證服務暫時不可用，ASM-12）的訊息。 */
const SERVICE_UNAVAILABLE_MESSAGE = '服務暫時無法使用，請稍後再試';

/** API 呼叫失敗；status 為 HTTP 狀態碼，網路錯誤時為 0。 */
export class ApiError extends Error {
  readonly status: number;
  readonly violationType: TApiErrorType;

  constructor(status: number, violationType: TApiErrorType, message?: string) {
    super(message ?? ERROR_MESSAGES[violationType]);
    this.name = 'ApiError';
    this.status = status;
    this.violationType = violationType;
  }
}

export type THttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type TRequestOptions<T> = {
  /** 預設 GET */
  method?: THttpMethod;
  /** 值為 undefined 的欄位不帶入 query string */
  query?: Record<string, string | undefined>;
  /** 以 JSON 序列化送出 */
  body?: unknown;
  /** 提供時以 zod 解析回應；204 一律回傳 undefined */
  schema?: z.ZodType<T>;
};

function buildUrl(path: string, query: TRequestOptions<unknown>['query']): URL {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url;
}

async function send(url: URL, method: THttpMethod, body: string | undefined): Promise<Response> {
  const headers = new Headers();
  const token = getIdToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  try {
    return await fetch(url, { method, headers, body });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR');
  }
}

/** 將非 2xx 回應轉為 ApiError。 */
async function toApiError(response: Response): Promise<ApiError> {
  const { status } = response;
  const payload: unknown = await response.json().catch(() => undefined);
  const parsedType = violationTypeSchema.safeParse(
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>).violationType
      : undefined,
  );

  if (status === 503) {
    return new ApiError(
      status,
      parsedType.success ? parsedType.data : 'SERVER_ERROR',
      SERVICE_UNAVAILABLE_MESSAGE,
    );
  }
  if (status >= 500) return new ApiError(status, 'SERVER_ERROR');
  if (parsedType.success) return new ApiError(status, parsedType.data);
  if (status === 401) return new ApiError(status, 'UNAUTHENTICATED');
  return new ApiError(status, 'SERVER_ERROR');
}

/**
 * 呼叫後端 API。
 * @param path 以 / 開頭的 API 路徑（例如 /api/transactions）
 * @param options 方法、query、body 與回應 schema
 */
export async function request<T = void>(
  path: string,
  options: TRequestOptions<T> = {},
): Promise<T> {
  const { method = 'GET', query, body, schema } = options;
  const url = buildUrl(path, query);
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);

  let response = await send(url, method, serializedBody);
  if (response.status === 401) {
    // R10：token 過期 → 重新登入後以新 token 重送一次；第二次仍 401 則交由下方轉為錯誤
    login();
    response = await send(url, method, serializedBody);
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204 || !schema) return undefined as T;

  const payload: unknown = await response.json().catch(() => undefined);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new ApiError(response.status, 'INVALID_RESPONSE');
  return parsed.data;
}
