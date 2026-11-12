/**
 * CLI：建立預設分類（部署時執行；冪等——已有任何分類時不動）。
 *
 * 用法：DATABASE_URL=... npm run seed:defaults
 * 失敗（env 不合法、DB 不可達）→ exit 1，讓 deploy.sh 中止。
 */
import { loadDatabaseEnv } from '../config/env';
import { disconnectPrismaClient, getPrismaClient } from '../db/prisma';
import { createLogger } from '../logging/logger';
import { OnboardingService } from '../services/onboarding-service';

async function main(): Promise<number> {
  let env;
  try {
    env = loadDatabaseEnv(process.env);
  } catch (error) {
    // EnvValidationError 的訊息只列 key 名稱、不含值
    process.stderr.write(`${error instanceof Error ? error.message : '環境變數驗證失敗'}\n`);
    return 1;
  }

  const logger = createLogger({ level: env.LOG_LEVEL });
  try {
    const { created } = await new OnboardingService(
      getPrismaClient(env.DATABASE_URL),
    ).ensureDefaultCategories();
    logger.info(
      { created },
      created > 0 ? 'default categories created' : 'categories already exist; skipped',
    );
    return 0;
  } catch (error) {
    // 只記錄錯誤名稱與代碼（Prisma 連線錯誤訊息含主機資訊）
    const { name, code } = (error ?? {}) as { name?: string; code?: string };
    logger.error({ errorName: name, errorCode: code }, 'seed default categories failed');
    return 1;
  } finally {
    await disconnectPrismaClient().catch(() => undefined);
  }
}

void main().then((exitCode) => {
  process.exitCode = exitCode;
});
