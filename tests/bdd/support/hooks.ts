/**
 * Cucumber hooks。
 *
 * BeforeAll : 取得測試 DB（TEST_DATABASE_URL 優先，否則 Testcontainers）→ prisma migrate deploy → 建立 PrismaClient
 * Before    : TRUNCATE 全部資料表（RESTART IDENTITY CASCADE），每個 Scenario 從空 DB 開始
 * AfterAll  : 斷線、停止容器
 */
import { AfterAll, Before, BeforeAll } from '@cucumber/cucumber';
import {
  acquireTestDatabase,
  createPrismaClient,
  getSharedPrisma,
  runMigrateDeploy,
  setSharedPrisma,
  truncateAll,
  type TestDatabase,
} from './db';

let database: TestDatabase | null = null;

BeforeAll({ timeout: 180_000 }, async function () {
  database = await acquireTestDatabase();
  runMigrateDeploy(database.url);
  setSharedPrisma(createPrismaClient(database.url));
});

Before(async function () {
  await truncateAll(getSharedPrisma());
});

AfterAll({ timeout: 60_000 }, async function () {
  await getSharedPrisma().$disconnect();
  setSharedPrisma(null);
  await database?.stop();
  database = null;
});
