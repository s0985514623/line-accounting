#!/usr/bin/env node
/* global process, console, fetch, AbortSignal */
// P2a 映像 smoke（跨平台 Node 腳本）。規格：plans/line-accounting/tdd-blueprint.md P2a。
//
// 執行：npm run smoke:image
// 流程：docker build -t la:smoke . -> 在 dev DB 容器內建立獨立的臨時 database
//       -> 映像內 prisma migrate deploy / dist/cli/seed-defaults.js
//       -> docker run -> 輪詢 /healthz 30 次 -> 驗 200
//       -> 驗 GET /liff/ 為 200 HTML、GET /liff/config.json 為 200（P8.3）
//       -> 驗 node 為 v24、容器以 node 使用者執行、映像不含 .env / specs / tests
//       -> 無論成敗皆清除容器與臨時 database。
//
// 可用環境變數覆寫：
//   SMOKE_DB_PORT        host 上 dev DB 的 port（預設 5434）
//   SMOKE_DB_CONTAINER   dev DB 容器名稱（預設 line-accounting-dev-db）
//   SMOKE_DB_HOST        容器內連 host 的主機名（預設 host.docker.internal）
//   SMOKE_DB_USER / SMOKE_DB_PASSWORD   DB 帳密（預設 test / test）
//   SMOKE_DB_ADMIN_DB    用來執行 CREATE/DROP DATABASE 的管理 database（預設 test）
//   SMOKE_IMAGE          映像 tag（預設 la:smoke）
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const IMAGE = process.env.SMOKE_IMAGE ?? 'la:smoke';
const DB_PORT = process.env.SMOKE_DB_PORT ?? '5434';
const DB_CONTAINER = process.env.SMOKE_DB_CONTAINER ?? 'line-accounting-dev-db';
const DB_HOST = process.env.SMOKE_DB_HOST ?? 'host.docker.internal';
const DB_USER = process.env.SMOKE_DB_USER ?? 'test';
const DB_PASSWORD = process.env.SMOKE_DB_PASSWORD ?? 'test';
const DB_ADMIN = process.env.SMOKE_DB_ADMIN_DB ?? 'test';
const SUFFIX = randomBytes(4).toString('hex');
const SMOKE_DB = `la_smoke_${SUFFIX}`;
const APP_CONTAINER = `la-smoke-${SUFFIX}`;
const HEALTHZ_ATTEMPTS = 30;
const HEALTHZ_INTERVAL_MS = 2000;

const results = [];
let dbCreated = false;
let appStarted = false;

function log(msg) {
  console.log(`[smoke] ${msg}`);
}

function docker(args, opts = {}) {
  const r = spawnSync('docker', args, { encoding: 'utf8', ...opts });
  if (r.error) throw new Error(`無法執行 docker：${r.error.message}`);
  return r;
}

function mustDocker(args, label, opts = {}) {
  const r = docker(args, opts);
  if (r.status !== 0) {
    throw new Error(`${label} 失敗（exit ${r.status}）\n${r.stdout ?? ''}${r.stderr ?? ''}`);
  }
  return r;
}

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function psqlAdmin(sql) {
  return mustDocker(
    [
      'exec',
      DB_CONTAINER,
      'psql',
      '-U',
      DB_USER,
      '-d',
      DB_ADMIN,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    `psql（${sql}）`,
  );
}

function cleanup() {
  if (appStarted) {
    docker(['rm', '-f', APP_CONTAINER]);
  }
  if (dbCreated) {
    const r = docker([
      'exec',
      DB_CONTAINER,
      'psql',
      '-U',
      DB_USER,
      '-d',
      DB_ADMIN,
      '-c',
      `DROP DATABASE IF EXISTS "${SMOKE_DB}" WITH (FORCE)`,
    ]);
    if (r.status !== 0) log(`警告：清除臨時 database ${SMOKE_DB} 失敗：${r.stderr}`);
  }
}

async function main() {
  const dbUrl = `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${SMOKE_DB}?schema=public&connection_limit=5`;
  const hostPort = await freePort();
  const envArgs = [
    '-e',
    'NODE_ENV=production',
    '-e',
    'PORT=3000',
    '-e',
    'LOG_LEVEL=info',
    '-e',
    `DATABASE_URL=${dbUrl}`,
    '-e',
    'LINE_CHANNEL_SECRET=smoke-secret',
    '-e',
    'LINE_CHANNEL_ACCESS_TOKEN=smoke-token',
    '-e',
    'LINE_LOGIN_CHANNEL_ID=1234567890',
    '-e',
    'LIFF_ID=1234567890-smokeliff',
    '-e',
    'LINE_OWNER_USER_ID=U00000000000000000000000000000000',
    '-e',
    'APP_BASE_URL=http://localhost',
  ];
  const hostArgs = ['--add-host', 'host.docker.internal:host-gateway'];

  // 1. build（先於建立 DB：缺 Dockerfile 時不留下任何副作用）
  log(`docker build -t ${IMAGE} .`);
  mustDocker(['build', '-t', IMAGE, '.'], 'docker build');

  // 2. 臨時 database
  log(`建立臨時 database ${SMOKE_DB}（容器 ${DB_CONTAINER}，host port ${DB_PORT}）`);
  psqlAdmin(`CREATE DATABASE "${SMOKE_DB}" OWNER "${DB_USER}"`);
  dbCreated = true;

  // 3. migrate + seed（映像內，使用編譯後的 dist/cli/seed-defaults.js）
  log('映像內 prisma migrate deploy');
  mustDocker(
    [
      'run',
      '--rm',
      ...hostArgs,
      ...envArgs,
      IMAGE,
      'node_modules/.bin/prisma',
      'migrate',
      'deploy',
    ],
    'prisma migrate deploy',
  );
  log('映像內 node dist/cli/seed-defaults.js');
  mustDocker(
    ['run', '--rm', ...hostArgs, ...envArgs, IMAGE, 'node', 'dist/cli/seed-defaults.js'],
    'seed-defaults',
  );

  // 4. 啟動並輪詢 /healthz
  log(`docker run -d ${APP_CONTAINER}（127.0.0.1:${hostPort} -> 3000）`);
  mustDocker(
    [
      'run',
      '-d',
      '--name',
      APP_CONTAINER,
      '-p',
      `127.0.0.1:${hostPort}:3000`,
      ...hostArgs,
      ...envArgs,
      IMAGE,
    ],
    'docker run',
  );
  appStarted = true;

  let status = 0;
  for (let i = 1; i <= HEALTHZ_ATTEMPTS; i++) {
    const running = docker(['inspect', '-f', '{{.State.Running}}', APP_CONTAINER]).stdout.trim();
    if (running !== 'true') {
      log(`容器已結束（第 ${i} 次）`);
      break;
    }
    try {
      const res = await fetch(`http://127.0.0.1:${hostPort}/healthz`, {
        signal: AbortSignal.timeout(2000),
      });
      status = res.status;
      if (status === 200) break;
    } catch {
      status = 0;
    }
    await sleep(HEALTHZ_INTERVAL_MS);
  }
  check('GET /healthz 回 HTTP 200', status === 200, `最後狀態 ${status}`);
  if (status !== 200) {
    const logs = docker(['logs', '--tail', '50', APP_CONTAINER]);
    console.error(`${logs.stdout}${logs.stderr}`);
  }

  // 4b. P8.3：LIFF 靜態檔（web build 產物須隨映像出貨）
  const base = `http://127.0.0.1:${hostPort}`;
  let liffStatus = 0;
  let liffType = '';
  let liffBody = '';
  try {
    const res = await fetch(`${base}/liff/`, { signal: AbortSignal.timeout(5000) });
    liffStatus = res.status;
    liffType = res.headers.get('content-type') ?? '';
    liffBody = await res.text();
  } catch {
    // 連線失敗：狀態維持 0
  }
  check(
    'GET /liff/ 回 200 且為 HTML',
    liffStatus === 200 && /text\/html/.test(liffType) && /<html|<!doctype html/i.test(liffBody),
    `狀態 ${liffStatus}，content-type ${liffType || '(無)'}`,
  );

  let cfgStatus = 0;
  let cfgBody = '';
  try {
    const res = await fetch(`${base}/liff/config.json`, { signal: AbortSignal.timeout(5000) });
    cfgStatus = res.status;
    cfgBody = await res.text();
  } catch {
    // 連線失敗：狀態維持 0
  }
  check('GET /liff/config.json 回 200', cfgStatus === 200, `狀態 ${cfgStatus}`);
  check(
    '/liff/config.json 的 liffId 為執行期 LIFF_ID',
    cfgBody.includes('1234567890-smokeliff'),
    cfgBody.slice(0, 120),
  );

  // 5. 映像內容檢查
  const nodeV = docker(['run', '--rm', '--entrypoint', 'node', IMAGE, '-v']).stdout.trim();
  check('映像內 node -v 為 v24', /^v24\./.test(nodeV), nodeV);

  const user = docker(['exec', APP_CONTAINER, 'id', '-un']).stdout.trim();
  check('容器以 node 使用者執行', user === 'node', `實際：${user || '(無法取得)'}`);

  const found = docker([
    'run',
    '--rm',
    '--entrypoint',
    'find',
    IMAGE,
    '/app',
    '-maxdepth',
    '2',
    '-not',
    '-path',
    '/app/node_modules/*',
    '(',
    '-name',
    '.env',
    '-o',
    '(',
    '-name',
    '.env.*',
    '-not',
    '-name',
    '.env.example',
    ')',
    '-o',
    '-name',
    'specs',
    '-o',
    '-name',
    'tests',
    ')',
  ]);
  check(
    '映像不含 .env / specs / tests',
    found.status === 0 && found.stdout.trim() === '',
    found.stdout.trim(),
  );
}

let exitCode = 1;
const onSignal = () => {
  cleanup();
  process.exit(130);
};
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

try {
  await main();
  exitCode = results.length > 0 && results.every((r) => r.ok) ? 0 : 1;
} catch (err) {
  console.error(`[smoke] 中止：${err.message}`);
} finally {
  cleanup();
}
log(exitCode === 0 ? '全部通過' : '失敗');
process.exit(exitCode);
