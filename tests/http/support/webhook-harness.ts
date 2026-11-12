/**
 * webhook HTTP 測試共用裝置：獨立 PostgreSQL schema（避免與 BDD / 其他測試檔平行執行時互相 TRUNCATE）。
 */
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../../src/app';
import {
  acquireTestDatabase,
  createPrismaClient,
  queryRows,
  runMigrateDeploy,
  truncateAll,
  withSchema,
  type TestDatabase,
} from '../../bdd/support/db';
import { signBody, webhookBody, type LineEvent } from '../../bdd/support/line-event-factory';
import {
  FixedClock,
  RecordingLineGateway,
  buildTestDeps,
  type TestDepsOptions,
} from '../../bdd/support/stubs';

export interface WebhookHarness {
  prisma: PrismaClient;
  /** 每次呼叫都清空資料與 gateway 紀錄。 */
  reset(): Promise<void>;
  makeApp(options?: Partial<TestDepsOptions>): { app: Express; line: RecordingLineGateway };
  countRows(
    table: 'categories' | 'category_keywords' | 'transactions' | 'postback_tokens',
  ): Promise<number>;
  close(): Promise<void>;
}

export async function createWebhookHarness(): Promise<WebhookHarness> {
  const database: TestDatabase = await acquireTestDatabase();
  const schemaName = `t_${randomBytes(6).toString('hex')}`;
  const schemaUrl = withSchema(database.url, schemaName);
  runMigrateDeploy(schemaUrl);
  const admin = createPrismaClient(database.url);
  const prisma = createPrismaClient(schemaUrl);

  return {
    prisma,
    async reset() {
      await truncateAll(prisma);
    },
    makeApp(options = {}) {
      const line = options.line ?? new RecordingLineGateway();
      const deps = buildTestDeps({ prisma, clock: new FixedClock(), ...options, line });
      return { app: createApp(deps), line };
    },
    async countRows(table) {
      const rows = await queryRows<{ n: bigint | number }>(
        prisma,
        `SELECT COUNT(*) AS n FROM ${table}`,
      );
      return Number(rows[0]?.n ?? 0);
    },
    async close() {
      await prisma.$disconnect();
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.$disconnect();
      await database.stop();
    },
  };
}

/** 送出已正確簽章的原始 body。 */
export function postSigned(app: Express, rawBody: string, secret?: string) {
  return request(app)
    .post('/webhook/line')
    .set('Content-Type', 'application/json')
    .set('x-line-signature', signBody(rawBody, secret))
    .send(rawBody);
}

export { signBody, webhookBody };
export type { LineEvent };
