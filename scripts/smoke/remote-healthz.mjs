#!/usr/bin/env node
/* global process, console, fetch, AbortSignal, URL */
// P2b 遠端 smoke：驗證已上線的 LINE 記帳服務（不是 whoami 佔位）。
//
// 執行：npm run smoke:remote -- https://accounting.ren-codes.com
//   或：node scripts/smoke/remote-healthz.mjs <baseUrl> [--retries N] [--interval-ms MS]
// 檢查：
//   1. GET  /healthz            -> 200
//   2. GET  /liff/config.json   -> 200，JSON 含非空字串 liffId
//   3. POST /webhook/line       -> 無 x-line-signature 時 401
//   4. GET  /liff/              -> 200 且 content-type 為 text/html
// 前三項以外任一失敗即以 1 結束；用法錯誤以 2 結束。
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const positional = [];
let retries = 1;
let intervalMs = 3000;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--retries') retries = Number(args[++i]);
  else if (args[i] === '--interval-ms') intervalMs = Number(args[++i]);
  else positional.push(args[i]);
}
if (positional.length !== 1 || !Number.isInteger(retries) || retries < 1) {
  console.error(
    '用法：node scripts/smoke/remote-healthz.mjs <baseUrl> [--retries N] [--interval-ms MS]',
  );
  process.exit(2);
}
let base;
try {
  base = new URL(positional[0]);
} catch {
  console.error(`無效的 baseUrl：${positional[0]}`);
  process.exit(2);
}
const url = (path) => new URL(path, base).toString();
const TIMEOUT_MS = 10_000;

async function request(path, init = {}) {
  return fetch(url(path), { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
}

const checks = [
  {
    name: 'GET /healthz 回 200',
    run: async () => {
      const res = await request('/healthz');
      if (res.status !== 200) throw new Error(`status=${res.status}`);
    },
  },
  {
    name: 'GET /liff/config.json 回 200 且含 liffId',
    run: async () => {
      const res = await request('/liff/config.json');
      if (res.status !== 200) throw new Error(`status=${res.status}`);
      const body = await res.json();
      if (typeof body?.liffId !== 'string' || body.liffId.length === 0) {
        throw new Error('回應缺少非空字串 liffId');
      }
    },
  },
  {
    name: 'POST /webhook/line 無簽章回 401',
    run: async () => {
      const res = await request('/webhook/line', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ destination: 'U0', events: [] }),
      });
      if (res.status !== 401) throw new Error(`status=${res.status}`);
    },
  },
  {
    name: 'GET /liff/ 回 HTML',
    run: async () => {
      const res = await request('/liff/');
      if (res.status !== 200) throw new Error(`status=${res.status}`);
      const type = res.headers.get('content-type') ?? '';
      if (!type.includes('text/html')) throw new Error(`content-type=${type}`);
    },
  },
];

async function runAll() {
  const failures = [];
  for (const check of checks) {
    try {
      await check.run();
      console.log(`PASS  ${check.name}`);
    } catch (err) {
      const reason = err instanceof Error ? (err.cause?.code ?? err.message) : String(err);
      console.log(`FAIL  ${check.name}（${reason}）`);
      failures.push(check.name);
    }
  }
  return failures;
}

let failures = [];
for (let attempt = 1; attempt <= retries; attempt += 1) {
  if (retries > 1) console.log(`--- 第 ${attempt}/${retries} 次 ${base.origin} ---`);
  failures = await runAll();
  if (failures.length === 0) break;
  if (attempt < retries) await sleep(intervalMs);
}

if (failures.length > 0) {
  console.error(`remote-healthz：${failures.length} 項失敗`);
  process.exit(1);
}
console.log('remote-healthz：全部通過');
