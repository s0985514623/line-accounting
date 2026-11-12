/**
 * HTTP 測試：GET /healthz（容器健康檢查，內部使用）
 *
 * 執行：TEST_DATABASE_URL=postgresql://test:test@localhost:5433/test npx vitest run tests/http/health.test.ts
 *       （未提供 TEST_DATABASE_URL 時自動改用 Testcontainers；需 Docker）
 *
 * 契約：createApp(deps) 掛載 GET /healthz → 以 `SELECT 1` 檢查 DB；成功 200，失敗 503。
 * 依據：implementation-plan P0-5、「失敗模式登記表」共用 Postgres 不可用。
 * 說明：健康檢查不需任何資料表，故不執行 migration。
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { acquireTestDatabase, createPrismaClient, type TestDatabase } from '../bdd/support/db';
import { buildTestDeps } from '../bdd/support/stubs';

let database: TestDatabase;
let healthyPrisma: ReturnType<typeof createPrismaClient>;
let brokenPrisma: ReturnType<typeof createPrismaClient>;

beforeAll(async () => {
  database = await acquireTestDatabase();
  healthyPrisma = createPrismaClient(database.url);
  // 指向不會有服務的埠號，模擬「DB 斷線」
  brokenPrisma = createPrismaClient(
    'postgresql://test:test-password-must-not-leak@127.0.0.1:1/test?connect_timeout=2',
  );
});

afterAll(async () => {
  await healthyPrisma?.$disconnect();
  await brokenPrisma?.$disconnect();
  await database?.stop();
});

describe('[Smoke] GET /healthz — DB 正常', () => {
  it('回 200', async () => {
    const app = createApp(buildTestDeps({ prisma: healthyPrisma }));
    const response = await request(app).get('/healthz');
    expect(response.status).toBe(200);
  });

  it('不需要任何認證 header（容器內部健康檢查）', async () => {
    const app = createApp(buildTestDeps({ prisma: healthyPrisma }));
    const response = await request(app).get('/healthz').unset('Authorization');
    expect(response.status).toBe(200);
  });
});

describe('[Error] GET /healthz — DB 斷線', () => {
  it('回 503', async () => {
    const app = createApp(buildTestDeps({ prisma: brokenPrisma }));
    const response = await request(app).get('/healthz');
    expect(response.status).toBe(503);
  });

  it('[Security] 503 回應不洩漏連線字串、帳號密碼或內部錯誤細節', async () => {
    const app = createApp(buildTestDeps({ prisma: brokenPrisma }));
    const response = await request(app).get('/healthz');
    expect(response.status).toBe(503);
    const text = response.text;
    expect(text).not.toContain('test-password-must-not-leak');
    expect(text).not.toContain('127.0.0.1');
    expect(text).not.toContain('postgresql://');
    expect(text).not.toMatch(/PrismaClient|ECONNREFUSED|stack/i);
  });
});
