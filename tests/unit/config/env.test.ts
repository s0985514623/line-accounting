/**
 * 單元測試：環境變數驗證（src/config/env.ts）
 *
 * 執行：npx vitest run tests/unit/config/env.test.ts    （或 npm run test:unit）
 *
 * 契約：export function loadEnv(source?: Record<string, string | undefined>): Env
 *   - 驗證通過 → 回傳含各環境變數（鍵名同環境變數名稱）的物件
 *   - 驗證失敗 → 拋出 Error（不呼叫 process.exit；由 server.ts 捕捉後 exit 1）
 *   - 錯誤訊息只列出「key 名稱」，絕不包含任何值（避免機敏資料進 log）
 * 依據：deployment-runbook.md §5.1、implementation-plan「錯誤處理登記表」config/env 列。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../../src/config/env';

const REQUIRED_KEYS = [
  'DATABASE_URL',
  'LINE_CHANNEL_SECRET',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_LOGIN_CHANNEL_ID',
  'LIFF_ID',
  'LINE_OWNER_USER_ID',
  'APP_BASE_URL',
] as const;

const VALID_OWNER_ID = `U${'0123456789abcdef'.repeat(2)}`;

function validEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PORT: '3000',
    LOG_LEVEL: 'info',
    APP_BASE_URL: 'https://ledger.example.com',
    DATABASE_URL:
      'postgresql://app:p%40ss@db:5432/line_accounting?schema=public&connection_limit=5',
    LINE_CHANNEL_SECRET: 'channel-secret-value-1234',
    LINE_CHANNEL_ACCESS_TOKEN: 'access-token-value-5678',
    LINE_LOGIN_CHANNEL_ID: '1234567890',
    LIFF_ID: '1234567890-AbCdEfGh',
    LINE_OWNER_USER_ID: VALID_OWNER_ID,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('[Smoke] loadEnv 基本行為', () => {
  it('完整且合法的環境變數 → 回傳設定值', () => {
    const env = loadEnv(validEnv());
    expect(env).toMatchObject({
      DATABASE_URL: validEnv().DATABASE_URL,
      LINE_CHANNEL_SECRET: 'channel-secret-value-1234',
      LINE_CHANNEL_ACCESS_TOKEN: 'access-token-value-5678',
      LINE_LOGIN_CHANNEL_ID: '1234567890',
      LIFF_ID: '1234567890-AbCdEfGh',
      LINE_OWNER_USER_ID: VALID_OWNER_ID,
      APP_BASE_URL: 'https://ledger.example.com',
    });
  });

  it('與目前行程的 process.env 無關：只讀取傳入的 source', () => {
    const before = { ...process.env };
    loadEnv(validEnv());
    expect(process.env).toEqual(before);
  });
});

describe('[Error] 缺少必要 key', () => {
  it.each(REQUIRED_KEYS)('缺少 %s → 拋錯且訊息列出該 key', (key) => {
    const source = validEnv();
    delete source[key];
    expect(() => loadEnv(source)).toThrow(new RegExp(key));
  });

  it.each(REQUIRED_KEYS)('%s 為空字串 → 視為缺少而拋錯', (key) => {
    const source = { ...validEnv(), [key]: '' };
    expect(() => loadEnv(source)).toThrow(new RegExp(key));
  });

  it('全部缺少 → 訊息一次列出所有必要 key', () => {
    let message = '';
    try {
      loadEnv({});
    } catch (error) {
      message = (error as Error).message;
    }
    for (const key of REQUIRED_KEYS) {
      expect(message).toContain(key);
    }
  });

  it('驗證失敗時以例外表達，不直接結束行程', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    expect(() => loadEnv({})).toThrow();
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('[Edge] LINE_OWNER_USER_ID 格式（^U[0-9a-f]{32}$）', () => {
  it.each([
    ['小寫 u 開頭', `u${'a'.repeat(32)}`],
    ['少一碼（31 碼）', `U${'a'.repeat(31)}`],
    ['多一碼（33 碼）', `U${'a'.repeat(33)}`],
    ['含非十六進位字元 g', `U${'a'.repeat(31)}g`],
    ['十六進位使用大寫', `U${'A'.repeat(32)}`],
    ['含前後空白', ` U${'a'.repeat(32)} `],
    ['只有 U', 'U'],
    ['測試用 id（U-owner）', 'U-owner'],
  ])('%s → 拒絕', (_label, value) => {
    expect(() => loadEnv({ ...validEnv(), LINE_OWNER_USER_ID: value })).toThrow(
      /LINE_OWNER_USER_ID/,
    );
  });

  it('U + 32 碼小寫十六進位 → 接受', () => {
    expect(() =>
      loadEnv({ ...validEnv(), LINE_OWNER_USER_ID: `U${'f0e1d2c3'.repeat(4)}` }),
    ).not.toThrow();
  });
});

describe('[Edge] DATABASE_URL 必須為 PostgreSQL URL', () => {
  it.each([
    ['mysql 協定', 'mysql://user:pw@localhost:3306/db'],
    ['http 協定', 'http://localhost:5432/db'],
    ['非 URL 字串', 'not-a-url'],
    ['只有主機名稱', 'localhost:5432'],
  ])('%s → 拒絕', (_label, value) => {
    expect(() => loadEnv({ ...validEnv(), DATABASE_URL: value })).toThrow(/DATABASE_URL/);
  });

  it('postgresql:// 含 URL 編碼密碼與查詢參數 → 接受', () => {
    expect(() =>
      loadEnv({
        ...validEnv(),
        DATABASE_URL:
          'postgresql://line_accounting:a%2Fb%40c@db:5432/line_accounting?schema=public',
      }),
    ).not.toThrow();
  });
});

describe('[Security] 錯誤訊息不得洩漏任何值', () => {
  it('格式錯誤的值不出現在錯誤訊息中', () => {
    const secretish = 'U-this-is-an-invalid-owner-id-xyz';
    const source = {
      ...validEnv(),
      LINE_OWNER_USER_ID: secretish,
      DATABASE_URL: 'mysql://root:SuperSecretPassword@host/db',
    };
    let message = '';
    try {
      loadEnv(source);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('LINE_OWNER_USER_ID');
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain(secretish);
    expect(message).not.toContain('SuperSecretPassword');
  });

  it('其他合法的機敏值（channel secret、access token）也不會出現在失敗訊息中', () => {
    const source = { ...validEnv(), LIFF_ID: '' };
    let message = '';
    try {
      loadEnv(source);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('LIFF_ID');
    expect(message).not.toContain('channel-secret-value-1234');
    expect(message).not.toContain('access-token-value-5678');
  });
});
