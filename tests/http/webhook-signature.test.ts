/**
 * HTTP 測試：POST /webhook/line 簽章驗證與請求格式
 *
 * 執行：TEST_DATABASE_URL=postgresql://test:test@localhost:5434/test npx vitest run tests/http/webhook-signature.test.ts
 *
 * 契約（nodejs-master 請遵循）：
 *   - src/line/webhook-route.ts：`express.raw({ type: '*\/*' })` 取得原始 body，以 channelSecret 做
 *     X-Line-Signature（HMAC-SHA256 base64）驗證，驗證通過才 JSON.parse（R7：簽章必須針對原始位元組）。
 *   - createApp(deps) 掛載 POST /webhook/line。
 *   - 無簽章 / 錯簽章 → 401；簽章正確但 body 非 JSON → 400；`events: []` → 200（LINE console「Verify」）。
 *   - 驗簽失敗：不得呼叫 lineGateway、不得寫入任何資料表。
 * 依據：implementation-plan P1-1、「失敗模式登記表」(R7)；specs/api/api.yml `/webhook/line`。
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { followEvent } from '../bdd/support/line-event-factory';
import {
  createWebhookHarness,
  postSigned,
  signBody,
  webhookBody,
  type WebhookHarness,
} from './support/webhook-harness';

let harness: WebhookHarness;

beforeAll(async () => {
  harness = await createWebhookHarness();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
});

describe('[Smoke] 簽章正確', () => {
  it('events: [] 回 200（LINE console Verify）且無任何副作用', async () => {
    const { app, line } = harness.makeApp();
    const response = await postSigned(app, webhookBody([]));
    expect(response.status).toBe(200);
    expect(line.replies).toHaveLength(0);
    expect(await harness.countRows('categories')).toBe(0);
  });
});

describe('[Error] 缺少或錯誤的簽章 → 401', () => {
  const body = webhookBody([followEvent('U-owner')]);

  it('沒有 x-line-signature header → 401，gateway 未呼叫，DB 無寫入', async () => {
    const { app, line } = harness.makeApp();
    const response = await request(app)
      .post('/webhook/line')
      .set('Content-Type', 'application/json')
      .send(body);
    expect(response.status).toBe(401);
    expect(line.replies).toHaveLength(0);
    expect(await harness.countRows('categories')).toBe(0);
  });

  it('簽章為空字串 → 401', async () => {
    const { app, line } = harness.makeApp();
    const response = await request(app)
      .post('/webhook/line')
      .set('Content-Type', 'application/json')
      .set('x-line-signature', '')
      .send(body);
    expect(response.status).toBe(401);
    expect(line.replies).toHaveLength(0);
  });

  it('簽章值錯誤 → 401，gateway 未呼叫，DB 無寫入（即使事件來自白名單 userId）', async () => {
    const { app, line } = harness.makeApp();
    const response = await request(app)
      .post('/webhook/line')
      .set('Content-Type', 'application/json')
      .set('x-line-signature', 'bm90LWEtdmFsaWQtc2lnbmF0dXJl')
      .send(body);
    expect(response.status).toBe(401);
    expect(line.replies).toHaveLength(0);
    expect(await harness.countRows('categories')).toBe(0);
  });

  it('以其他 channel secret 簽署 → 401', async () => {
    const { app, line } = harness.makeApp();
    const response = await postSigned(app, body, 'another-secret');
    expect(response.status).toBe(401);
    expect(line.replies).toHaveLength(0);
    expect(await harness.countRows('categories')).toBe(0);
  });

  it('簽章非 base64 的任意字串（含特殊字元、超長）→ 401 且不拋 500', async () => {
    const { app } = harness.makeApp();
    for (const signature of ['!!!<script>alert(1)</script>', 'A'.repeat(5000)]) {
      const response = await request(app)
        .post('/webhook/line')
        .set('Content-Type', 'application/json')
        .set('x-line-signature', signature)
        .send(body);
      expect(response.status).toBe(401);
    }
  });

  it('[Security] 簽章對應的是「改寫前」的 body（body 被竄改）→ 401', async () => {
    const { app, line } = harness.makeApp();
    const signedFor = webhookBody([]);
    const tampered = body;
    const response = await request(app)
      .post('/webhook/line')
      .set('Content-Type', 'application/json')
      .set('x-line-signature', signBody(signedFor))
      .send(tampered);
    expect(response.status).toBe(401);
    expect(line.replies).toHaveLength(0);
    expect(await harness.countRows('categories')).toBe(0);
  });
});

describe('[Edge] 簽章與原始位元組', () => {
  it('JSON 含非 ASCII / Emoji / 額外空白時，以「原始 body」驗簽仍通過 → 200', async () => {
    const { app } = harness.makeApp();
    const raw = '{ "destination": "U-bot", "events": [ ] , "note": "午餐 😀" }';
    const response = await postSigned(app, raw);
    expect(response.status).toBe(200);
  });

  it('401 回應不洩漏 channel secret', async () => {
    const { app } = harness.makeApp();
    const response = await request(app)
      .post('/webhook/line')
      .set('Content-Type', 'application/json')
      .send(webhookBody([]));
    expect(response.status).toBe(401);
    expect(response.text).not.toContain('test-secret');
  });
});

describe('[Error] 簽章正確但內容不合法', () => {
  it('body 非 JSON → 400', async () => {
    const { app, line } = harness.makeApp();
    const response = await postSigned(app, 'this is not json');
    expect(response.status).toBe(400);
    expect(line.replies).toHaveLength(0);
  });
});
