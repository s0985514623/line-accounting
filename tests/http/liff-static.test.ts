/**
 * HTTP 測試：Express 提供 LIFF 靜態檔（P8.3）
 *
 * 執行：TEST_DATABASE_URL=postgresql://test:test@localhost:5434/test npx vitest run tests/http/liff-static.test.ts
 *       （未提供 TEST_DATABASE_URL 時自動改用 Testcontainers；需 Docker）
 *
 * 契約（nodejs-master 請遵循；依據 implementation-plan P8 步驟 5、tdd-blueprint P8.3、deployment-runbook §2）：
 *   - src/app.ts：`AppDeps` 新增選用欄位 `webDistDir?: string`（前端 build 產物目錄，內含 index.html 與 assets/*）。
 *     未提供時預設為「相對於 app 模組」的 `../web/dist`（src/app.ts 與 dist/app.js 皆解析到 repo 或映像 /app 的 web/dist）。
 *     本測試一律注入暫存目錄，不依賴真實 web build。
 *   - src/http/routes/liff-static.ts：匯出 createLiffStaticRouter({ webDistDir, liffId })，由 createApp 掛載。
 *       GET /liff/config.json        → 200 JSON { liffId: config.liffId }（執行期由 env 注入，非 dist 內檔案），
 *                                       Cache-Control 含 no-store 或 no-cache
 *       GET /liff/assets/*           → 檔案存在 200 + Cache-Control 含 immutable 且 max-age >= 1 年；
 *                                       不存在 → 404（不得 fallback 成 index.html）
 *       GET /liff、/liff/、/liff/** 其他路徑 → SPA fallback，200 回 index.html，Cache-Control 含 no-cache
 *   - helmet CSP：script-src / connect-src / img-src 等允許 *.line-scdn.net、api.line.me、access.line.me（與 liff.line.me）；
 *     全站回應皆帶 CSP header。
 *   - /healthz、/api/*、/webhook/line 行為不受影響（不被 SPA fallback 吞掉）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { buildTestDeps, TEST_LIFF_ID } from '../bdd/support/stubs';
import { createWebhookHarness, type WebhookHarness } from './support/webhook-harness';

const INDEX_MARKER = 'LIFF-INDEX-MARKER-7f3a';
const SECRET_MARKER = 'OUTSIDE-DIST-SECRET-91bc';
const ONE_YEAR_SECONDS = 31_536_000;

let harness: WebhookHarness;
let sandboxDir: string;
let distDir: string;
let app: Express;

function cacheControl(response: request.Response): string {
  return String(response.headers['cache-control'] ?? '');
}

/** 解析 CSP header 為 directive → 來源清單。 */
function parseCsp(response: request.Response): Map<string, string[]> {
  const raw = String(response.headers['content-security-policy'] ?? '');
  const directives = new Map<string, string[]>();
  for (const part of raw.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const [name, ...sources] = tokens;
    if (name) directives.set(name, sources);
  }
  return directives;
}

beforeAll(async () => {
  harness = await createWebhookHarness();

  sandboxDir = mkdtempSync(join(tmpdir(), 'liff-static-'));
  distDir = join(sandboxDir, 'dist');
  mkdirSync(join(distDir, 'assets'), { recursive: true });
  writeFileSync(
    join(distDir, 'index.html'),
    `<!doctype html><html><head><title>${INDEX_MARKER}</title></head><body><div id="root"></div></body></html>\n`,
  );
  writeFileSync(join(distDir, 'assets', 'index-abc123.js'), 'console.log("main-chunk");\n');
  writeFileSync(join(distDir, 'assets', 'chart-9f8e7d.js'), 'console.log("lazy-chart-chunk");\n');
  writeFileSync(join(distDir, 'assets', 'index-abc123.css'), 'body{margin:0}\n');
  // 誘餌：dist 內即使放了 config.json，也必須以執行期 env 的 liffId 為準
  writeFileSync(join(distDir, 'config.json'), '{"liffId":"STALE-FROM-DIST"}\n');
  // dist 之外的機敏檔：路徑穿越不得讀到
  writeFileSync(join(sandboxDir, 'secret.txt'), `${SECRET_MARKER}\n`);

  const deps = buildTestDeps({ prisma: harness.prisma });
  app = createApp({ ...deps, webDistDir: distDir } as Parameters<typeof createApp>[0]);
});

afterAll(async () => {
  await harness?.close();
  if (sandboxDir) rmSync(sandboxDir, { recursive: true, force: true });
});

describe('[Smoke] /liff/ 與 /liff/config.json', () => {
  it('GET /liff/ 回 200 HTML（index.html）', async () => {
    const response = await request(app).get('/liff/');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain(INDEX_MARKER);
  });

  it('GET /liff/config.json 回 200 且為 { liffId }', async () => {
    const response = await request(app).get('/liff/config.json');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({ liffId: TEST_LIFF_ID });
  });
});

describe('[Happy] /liff/config.json', () => {
  it('Cache-Control 為 no-store 或 no-cache（換 LIFF_ID 不可被舊快取卡住）', async () => {
    const response = await request(app).get('/liff/config.json');
    expect(cacheControl(response)).toMatch(/no-store|no-cache/);
    expect(cacheControl(response)).not.toMatch(/immutable/);
  });

  it('liffId 取自執行期設定，而非 dist 內的同名檔案', async () => {
    const response = await request(app).get('/liff/config.json');
    expect(response.body.liffId).toBe(TEST_LIFF_ID);
    expect(response.body.liffId).not.toBe('STALE-FROM-DIST');
  });

  it('不同 config.liffId 的 app 回不同值（同一映像可用於不同環境）', async () => {
    const deps = buildTestDeps({ prisma: harness.prisma });
    const other = createApp({
      ...deps,
      config: { ...deps.config, liffId: '2000000000-otherliff' },
      webDistDir: distDir,
    } as Parameters<typeof createApp>[0]);
    const response = await request(other).get('/liff/config.json');
    expect(response.body).toEqual({ liffId: '2000000000-otherliff' });
  });

  it('回應只含 liffId（不外洩 channelSecret / ownerUserId 等其他設定）', async () => {
    const response = await request(app).get('/liff/config.json');
    expect(Object.keys(response.body)).toEqual(['liffId']);
    expect(response.text).not.toContain('test-secret');
    expect(response.text).not.toContain('U-owner');
  });
});

describe('[Happy] SPA fallback → index.html 且 no-cache', () => {
  const spaPaths = [
    '/liff/',
    '/liff/edit/3',
    '/liff/chart?month=2026-11',
    '/liff/categories',
    '/liff/records',
    '/liff/edit/3/',
    '/liff/edit/%E4%B8%AD%E6%96%87',
  ];

  it.each(spaPaths)('GET %s → 200 index.html，Cache-Control 含 no-cache', async (path) => {
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain(INDEX_MARKER);
    expect(cacheControl(response)).toMatch(/no-cache|no-store/);
    expect(cacheControl(response)).not.toMatch(/immutable/);
  });

  it('GET /liff（無結尾斜線）→ 直接回 index.html，或導向 /liff/', async () => {
    const response = await request(app).get('/liff');
    if (response.status === 200) {
      expect(response.text).toContain(INDEX_MARKER);
    } else {
      expect([301, 302, 307, 308]).toContain(response.status);
      expect(String(response.headers.location)).toBe('/liff/');
    }
  });
});

describe('[Happy] /liff/assets/* 長快取', () => {
  it('JS chunk：200、正確 content-type、immutable 且 max-age >= 1 年', async () => {
    const response = await request(app).get('/liff/assets/index-abc123.js');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/javascript/);
    expect(response.text).toContain('main-chunk');
    const cc = cacheControl(response);
    expect(cc).toMatch(/immutable/);
    const maxAge = Number(/max-age=(\d+)/.exec(cc)?.[1] ?? 0);
    expect(maxAge).toBeGreaterThanOrEqual(ONE_YEAR_SECONDS);
  });

  it('圖表頁 lazy chunk 亦為 immutable', async () => {
    const response = await request(app).get('/liff/assets/chart-9f8e7d.js');
    expect(response.status).toBe(200);
    expect(response.text).toContain('lazy-chart-chunk');
    expect(cacheControl(response)).toMatch(/immutable/);
  });

  it('CSS：200、text/css、immutable', async () => {
    const response = await request(app).get('/liff/assets/index-abc123.css');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/css/);
    expect(cacheControl(response)).toMatch(/immutable/);
  });
});

describe('[Error] 不存在的靜態資源不得 fallback 成 index.html', () => {
  it.each(['/liff/assets/x.js', '/liff/assets/missing.css', '/liff/assets/nested/none.js'])(
    'GET %s → 404 且不是 index.html',
    async (path) => {
      const response = await request(app).get(path);
      expect(response.status).toBe(404);
      expect(response.text).not.toContain(INDEX_MARKER);
      expect(response.text).not.toContain('id="root"');
    },
  );

  it('404 的 assets 回應不得帶 immutable 長快取（避免瀏覽器快取壞掉的 404）', async () => {
    const response = await request(app).get('/liff/assets/x.js');
    expect(cacheControl(response)).not.toMatch(/immutable/);
  });

  it('非 GET（POST /liff/edit/3）不被 SPA fallback 處理', async () => {
    const response = await request(app).post('/liff/edit/3').send({});
    expect(response.status).toBe(404);
    expect(response.text).not.toContain(INDEX_MARKER);
  });
});

describe('[Security] 路徑穿越與 CSP', () => {
  it.each([
    '/liff/assets/..%2f..%2fsecret.txt',
    '/liff/assets/%2e%2e/%2e%2e/secret.txt',
    '/liff/..%2fsecret.txt',
    '/liff/assets/%2e%2e%2f%2e%2e%2fsecret.txt',
  ])('GET %s 不得讀到 dist 之外的檔案', async (path) => {
    const response = await request(app).get(path);
    expect(response.text).not.toContain(SECRET_MARKER);
    expect(response.status).not.toBe(500);
  });

  it('SPA 頁面回應帶 CSP header', async () => {
    const response = await request(app).get('/liff/');
    expect(response.headers['content-security-policy']).toBeTruthy();
  });

  it('config.json 與 assets 回應也帶 CSP header', async () => {
    const config = await request(app).get('/liff/config.json');
    const asset = await request(app).get('/liff/assets/index-abc123.js');
    expect(config.headers['content-security-policy']).toBeTruthy();
    expect(asset.headers['content-security-policy']).toBeTruthy();
  });

  it('script-src 允許 self 與 https://*.line-scdn.net，且不含 unsafe-eval', async () => {
    const csp = parseCsp(await request(app).get('/liff/'));
    const scriptSrc = csp.get('script-src') ?? [];
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain('https://*.line-scdn.net');
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('connect-src 允許 self、api.line.me、access.line.me、liff.line.me、*.line-scdn.net', async () => {
    const csp = parseCsp(await request(app).get('/liff/'));
    const connectSrc = csp.get('connect-src') ?? [];
    expect(connectSrc).toContain("'self'");
    expect(connectSrc).toContain('https://api.line.me');
    expect(connectSrc).toContain('https://access.line.me');
    expect(connectSrc).toContain('https://liff.line.me');
    expect(connectSrc).toContain('https://*.line-scdn.net');
  });

  it('img-src 允許 self、data: 與 https://*.line-scdn.net（LINE 頭像）', async () => {
    const csp = parseCsp(await request(app).get('/liff/'));
    const imgSrc = csp.get('img-src') ?? [];
    expect(imgSrc).toContain("'self'");
    expect(imgSrc).toContain('data:');
    expect(imgSrc).toContain('https://*.line-scdn.net');
  });

  it('不放寬到萬用來源：default-src / script-src 不含裸 * 與 unsafe-inline script', async () => {
    const csp = parseCsp(await request(app).get('/liff/'));
    expect(csp.get('default-src') ?? []).not.toContain('*');
    expect(csp.get('script-src') ?? []).not.toContain('*');
    expect(csp.get('script-src') ?? []).not.toContain("'unsafe-inline'");
  });
});

describe('[Regression] 既有路由不受影響', () => {
  it('GET /healthz 仍回 200（非 SPA fallback）', async () => {
    const response = await request(app).get('/healthz');
    expect(response.status).toBe(200);
    expect(response.text).not.toContain(INDEX_MARKER);
  });

  it('GET /api/categories 無 Authorization 仍回 401 UNAUTHENTICATED', async () => {
    const response = await request(app).get('/api/categories?ledger=personal&entryType=expense');
    expect(response.status).toBe(401);
    expect(response.body.violationType).toBe('UNAUTHENTICATED');
  });

  it('GET /api/不存在的路徑 不會回 index.html', async () => {
    const response = await request(app).get('/api/no-such-route');
    expect(response.text).not.toContain(INDEX_MARKER);
  });

  it('POST /webhook/line 無簽章仍回 401', async () => {
    const response = await request(app)
      .post('/webhook/line')
      .set('Content-Type', 'application/json')
      .send('{"events":[]}');
    expect(response.status).toBe(401);
  });

  it('GET /liff 以外的不存在路徑回 404 且非 index.html', async () => {
    const response = await request(app).get('/some/other/path');
    expect(response.status).toBe(404);
    expect(response.text).not.toContain(INDEX_MARKER);
  });
});
