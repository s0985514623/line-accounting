/**
 * Cucumber World：每個 Scenario 一個實例。
 *
 * app 經 `createApp(deps)`（src/app.ts）取得；此檔以「動態載入」引用 src/app，
 * 因此 src 尚未實作時 `cucumber-js --dry-run` 仍可驗證 step 定義（實際執行才會因缺模組而紅燈）。
 */
import { World, setWorldConstructor, type IWorldOptions } from '@cucumber/cucumber';
import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import supertest from 'supertest';
import { getSharedPrisma } from './db';
import {
  DEFAULT_OWNER_USER_ID,
  FixedClock,
  RecordingLineGateway,
  StubIdTokenVerifier,
  TEST_CHANNEL_SECRET,
  TEST_LIFF_ID,
  buildTestDeps,
} from './stubs';

export class TestWorld extends World {
  readonly clock = new FixedClock();
  readonly line = new RecordingLineGateway();
  readonly idToken = new StubIdTokenVerifier();
  readonly config = {
    ownerUserId: DEFAULT_OWNER_USER_ID,
    channelSecret: TEST_CHANNEL_SECRET,
    liffId: TEST_LIFF_ID,
  };
  /** G7 設定；null 代表沒有 Authorization header（W3–W10 使用）。 */
  liffIdentity: string | null = null;
  lastResponse: supertest.Response | null = null;
  /** 供 `$記帳紀錄.id` 解析。 */
  lastTransactionId: number | null = null;

  private appInstance: Express | null = null;

  constructor(options: IWorldOptions) {
    super(options);
  }

  /** 共用 PrismaClient（BeforeAll 建立；dry-run 不執行 hooks，故以 getter 延遲取得）。 */
  get prisma(): PrismaClient {
    return getSharedPrisma();
  }

  /** G1：變更白名單後，下次取得 app 時重建。 */
  setOwnerUserId(userId: string): void {
    this.config.ownerUserId = userId;
    this.appInstance = null;
  }

  async getApp(): Promise<Express> {
    if (this.appInstance) return this.appInstance;
    // 以 require 延遲載入（tsx/cjs 可直接載入 .ts；dynamic import() 不經 tsx 轉譯，會找不到 .ts）
    const { createApp } = require('../../../src/app') as typeof import('../../../src/app');
    const app: Express = createApp(
      buildTestDeps({
        prisma: this.prisma,
        ownerUserId: this.config.ownerUserId,
        clock: this.clock,
        line: this.line,
        idToken: this.idToken,
      }),
    );
    this.appInstance = app;
    return app;
  }

  /** supertest 入口（綁定本 Scenario 的 app）。 */
  async http() {
    return supertest(await this.getApp());
  }

  /** LIFF 請求的 Authorization header；未設定身分時為空物件。 */
  liffAuthHeaders(): Record<string, string> {
    return this.liffIdentity === null ? {} : { Authorization: `Bearer ${this.liffIdentity}` };
  }
}

setWorldConstructor(TestWorld);
