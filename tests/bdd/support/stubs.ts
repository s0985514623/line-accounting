/**
 * 測試替身與 createApp 依賴組裝（BDD 與 HTTP 測試共用）。
 *
 * 【與實作端（src/）的契約 —— 由測試定義，實作必須符合】
 *  - src/app.ts            export function createApp(deps): Express
 *      deps = {
 *        prisma,                 // PrismaClient
 *        clock,                  // { now(): Date }（本替身另提供 today(): 'YYYY-MM-DD'，Asia/Taipei）
 *        lineGateway,            // { reply(replyToken: string, messages: LineMessage[]): Promise<void> }
 *        idTokenVerifier,        // { verify(idToken: string): Promise<{ sub: string }> }
 *        config: {
 *          ownerUserId, channelSecret, liffId, lineLoginChannelId, appBaseUrl, logLevel
 *        },
 *      }
 *  - src/ports/id-token-verifier.ts  export class InvalidTokenError extends Error（建構子可不帶參數）
 *      verify() 遇到無效 token 必須拋出 InvalidTokenError（→ 401 UNAUTHENTICATED）
 *  - LineMessage 為 LINE Messaging API 訊息物件的子集（domain 層型別，結構同 SDK JSON）：
 *      { type: 'text', text, quickReply?: { items: [{ type: 'action',
 *          action: { type: 'postback', label, data, displayText? } }] } }
 *      { type: 'template', altText, template:
 *          { type: 'buttons' | 'confirm', text, actions: [
 *              { type: 'postback', label, data } | { type: 'uri', label, uri } ] } }
 */
import type { PrismaClient } from '@prisma/client';

// ---- LINE 訊息型別（測試端的期望結構） -------------------------------------------------------

export interface PostbackAction {
  type: 'postback';
  label: string;
  data: string;
  displayText?: string;
}

export interface UriAction {
  type: 'uri';
  label: string;
  uri: string;
}

export type TemplateAction = PostbackAction | UriAction;

export interface QuickReplyItem {
  type: 'action';
  action: PostbackAction;
}

export interface TextMessage {
  type: 'text';
  text: string;
  quickReply?: { items: QuickReplyItem[] };
}

export interface TemplateMessage {
  type: 'template';
  altText: string;
  template: {
    type: 'buttons' | 'confirm';
    text: string;
    actions: TemplateAction[];
  };
}

export type LineMessage = TextMessage | TemplateMessage;

export interface RecordedReply {
  replyToken: string;
  messages: LineMessage[];
}

// ---- 固定時鐘 --------------------------------------------------------------------------------

/**
 * 固定時鐘。`set('2026-11-12')` → 台北當日中午（UTC 04:00），避免時區邊界誤判。
 * 預設 2026-11-12T04:00:00Z（台北 12:00）。
 */
export class FixedClock {
  private current: Date;

  constructor(date = '2026-11-12') {
    this.current = FixedClock.taipeiNoon(date);
  }

  private static taipeiNoon(date: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`今天的日期格式必須為 YYYY-MM-DD，實際為：${date}`);
    }
    const parsed = new Date(`${date}T04:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error(`不合法的日期：${date}`);
    }
    return parsed;
  }

  set(date: string): void {
    this.current = FixedClock.taipeiNoon(date);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  /** Asia/Taipei 的今天（YYYY-MM-DD）。 */
  today(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(this.current);
  }
}

// ---- LINE 回覆閘道 ---------------------------------------------------------------------------

/** 記錄 domain 層的 reply 內容（非 SDK 請求 JSON）。 */
export class RecordingLineGateway {
  readonly replies: RecordedReply[] = [];

  async reply(replyToken: string, messages: LineMessage[]): Promise<void> {
    this.replies.push({ replyToken, messages: structuredClone(messages) });
  }

  /** 轉成 LINE SDK replyMessage 請求內容（供 builder 單元測試比對）。 */
  toSdk(): Array<{ replyToken: string; messages: LineMessage[] }> {
    return this.replies.map((r) => ({
      replyToken: r.replyToken,
      messages: structuredClone(r.messages),
    }));
  }

  clear(): void {
    this.replies.length = 0;
  }
}

// ---- LIFF ID token 驗證替身 ------------------------------------------------------------------

export const INVALID_TOKEN_IDENTITY = '(無效token)';

/**
 * ID token 驗證替身：token 即 identity 字串（`Authorization: Bearer U-owner`）。
 * `(無效token)` 拋出 InvalidTokenError，其餘回傳 { sub: token }。
 */
export class StubIdTokenVerifier {
  async verify(idToken: string): Promise<{ sub: string }> {
    // world.liffAuthHeaders() 以 encodeURIComponent 編碼 identity（header 不可含非 Latin-1 字元），此處還原
    let identity = idToken;
    try {
      identity = decodeURIComponent(idToken);
    } catch {
      // 非合法編碼：原樣比對
    }
    if (identity === INVALID_TOKEN_IDENTITY) {
      // 延遲載入：src 尚未實作時不影響 dry-run / 其他測試載入（tsx/cjs 下 require 可載入 .ts）
      const { InvalidTokenError } =
        require('../../../src/ports/id-token-verifier') as typeof import('../../../src/ports/id-token-verifier');
      throw new InvalidTokenError();
    }
    return { sub: identity };
  }
}

// ---- createApp 依賴組裝 ----------------------------------------------------------------------

export const TEST_CHANNEL_SECRET = 'test-secret';
export const TEST_LIFF_ID = 'test-liff';
export const DEFAULT_OWNER_USER_ID = 'U-owner';

export interface TestDepsOptions {
  prisma: PrismaClient;
  ownerUserId?: string;
  clock?: FixedClock;
  line?: RecordingLineGateway;
  idToken?: StubIdTokenVerifier;
}

export function buildTestDeps(options: TestDepsOptions) {
  return {
    prisma: options.prisma,
    clock: options.clock ?? new FixedClock(),
    lineGateway: options.line ?? new RecordingLineGateway(),
    idTokenVerifier: options.idToken ?? new StubIdTokenVerifier(),
    config: {
      ownerUserId: options.ownerUserId ?? DEFAULT_OWNER_USER_ID,
      channelSecret: TEST_CHANNEL_SECRET,
      liffId: TEST_LIFF_ID,
      lineLoginChannelId: 'test-login-channel',
      appBaseUrl: 'http://localhost',
      logLevel: 'silent',
    },
  };
}

export type TestDeps = ReturnType<typeof buildTestDeps>;
