/**
 * 執行期環境變數驗證（deployment-runbook §5.1）。
 * 驗證失敗時拋出 EnvValidationError：訊息只列出 key 名稱，絕不包含任何值。
 * 由 server.ts 捕捉後 exit 1（本模組不呼叫 process.exit）。
 */
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const POSTGRES_PROTOCOLS = new Set(['postgresql:', 'postgres:']);

const requiredString = z.string().min(1);

const postgresUrl = requiredString.refine((value) => {
  try {
    const url = new URL(value);
    return POSTGRES_PROTOCOLS.has(url.protocol) && url.hostname !== '';
  } catch {
    return false;
  }
});

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  APP_BASE_URL: z.url({ protocol: /^https?$/ }),
  DATABASE_URL: postgresUrl,
  LINE_CHANNEL_SECRET: requiredString,
  LINE_CHANNEL_ACCESS_TOKEN: requiredString,
  LINE_LOGIN_CHANNEL_ID: requiredString,
  LIFF_ID: requiredString,
  LINE_OWNER_USER_ID: z.string().regex(/^U[0-9a-f]{32}$/),
});

export type Env = z.infer<typeof EnvSchema>;

/** 環境變數驗證失敗；invalidKeys 為缺少或格式不合法的 key（不含值）。 */
export class EnvValidationError extends Error {
  override readonly name = 'EnvValidationError';

  constructor(readonly invalidKeys: readonly string[]) {
    super(`環境變數缺少或格式不合法：${invalidKeys.join(', ')}`);
  }
}

type EnvSource = Record<string, string | undefined>;

/** 以 schema 驗證 source；失敗時只回報 key 名稱（zod 的 issue message 可能夾帶輸入值，故不採用）。 */
function parseEnv<T extends z.ZodType>(schema: T, source: EnvSource): z.infer<T> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;

  const keys = new Set<string>();
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    keys.add(typeof key === 'string' ? key : '(unknown)');
  }
  throw new EnvValidationError([...keys]);
}

/**
 * 驗證環境變數。只讀取傳入的 source（預設 process.env），不修改它。
 * @throws EnvValidationError 任何 key 缺少或格式不合法
 */
export function loadEnv(source: EnvSource = process.env): Env {
  return parseEnv(EnvSchema, source);
}

const DatabaseEnvSchema = EnvSchema.pick({ DATABASE_URL: true, LOG_LEVEL: true });

export type DatabaseEnv = z.infer<typeof DatabaseEnvSchema>;

/**
 * 只需要資料庫的 CLI（seed-defaults 等）使用：僅驗證 DATABASE_URL（與 LOG_LEVEL）。
 * @throws EnvValidationError
 */
export function loadDatabaseEnv(source: EnvSource = process.env): DatabaseEnv {
  return parseEnv(DatabaseEnvSchema, source);
}

/** createApp 所需的設定（與測試替身 buildTestDeps().config 同形）。 */
export interface AppConfig {
  ownerUserId: string;
  channelSecret: string;
  liffId: string;
  lineLoginChannelId: string;
  appBaseUrl: string;
  logLevel: string;
}

export function toAppConfig(env: Env): AppConfig {
  return {
    ownerUserId: env.LINE_OWNER_USER_ID,
    channelSecret: env.LINE_CHANNEL_SECRET,
    liffId: env.LIFF_ID,
    lineLoginChannelId: env.LINE_LOGIN_CHANNEL_ID,
    appBaseUrl: env.APP_BASE_URL.replace(/\/+$/, ''),
    logLevel: env.LOG_LEVEL,
  };
}
