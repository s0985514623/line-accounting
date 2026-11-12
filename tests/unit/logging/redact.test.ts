/**
 * 單元測試：log 機敏欄位遮蔽（pino redact）
 *
 * 執行：npx vitest run tests/unit/logging/redact.test.ts    （或 npm run test:unit）
 *
 * 契約：
 *   - src/logging/logger.ts
 *       export function createLogger(options?: { level?: string; destination?: NodeJS.WritableStream }): pino.Logger
 *       redact 路徑至少含：req.headers.authorization、req.headers["x-line-signature"]、*.token、*.accessToken
 *   - src/http/middleware/request-logger.ts
 *       export function createRequestLogger(logger: pino.Logger): express.RequestHandler   （pino-http）
 * 依據：deployment-runbook.md §5.1（pino redact）、implementation-plan「secrets 外洩（log）」失敗模式。
 */
import { Writable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createRequestLogger } from '../../../src/http/middleware/request-logger';
import { createLogger } from '../../../src/logging/logger';

/** 收集 pino 輸出的 JSON 行。 */
function captureStream() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    raw: () => chunks.join(''),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe('[Happy] createLogger 遮蔽機敏欄位', () => {
  it('req.headers.authorization 與 x-line-signature 被遮蔽，其他欄位保留', () => {
    const out = captureStream();
    const logger = createLogger({ level: 'info', destination: out.stream });

    logger.info(
      {
        req: {
          method: 'POST',
          url: '/api/transactions',
          headers: {
            authorization: 'Bearer eyJ.SECRET-ID-TOKEN.sig',
            'x-line-signature': 'SECRET-SIGNATURE==',
            'content-type': 'application/json',
          },
        },
      },
      'incoming',
    );

    const raw = out.raw();
    expect(raw).not.toContain('SECRET-ID-TOKEN');
    expect(raw).not.toContain('SECRET-SIGNATURE');
    const [line] = out.lines();
    const req = line?.req as { method: string; url: string; headers: Record<string, string> };
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/api/transactions');
    expect(req.headers['content-type']).toBe('application/json');
    expect(line?.msg).toBe('incoming');
  });

  it('巢狀物件下的 token / accessToken 被遮蔽', () => {
    const out = captureStream();
    const logger = createLogger({ level: 'info', destination: out.stream });

    logger.info({ line: { token: 'SECRET-REPLY-TOKEN', accessToken: 'SECRET-ACCESS-TOKEN' } }, 'x');
    logger.info({ postback: { token: 'SECRET-PICK-TOKEN', categoryId: 3 } }, 'y');

    const raw = out.raw();
    expect(raw).not.toContain('SECRET-REPLY-TOKEN');
    expect(raw).not.toContain('SECRET-ACCESS-TOKEN');
    expect(raw).not.toContain('SECRET-PICK-TOKEN');
    expect(out.lines()[1]?.postback).toMatchObject({ categoryId: 3 });
  });
});

describe('[Edge] 遮蔽不破壞日誌可用性', () => {
  it('欄位不存在時不拋錯', () => {
    const out = captureStream();
    const logger = createLogger({ level: 'info', destination: out.stream });
    expect(() => logger.info({ req: { headers: {} } }, 'no secrets')).not.toThrow();
    expect(() => logger.info('plain message')).not.toThrow();
  });

  it('遮蔽值是固定佔位字串而非原值（不同機敏值遮蔽後無法區分）', () => {
    const out = captureStream();
    const logger = createLogger({ level: 'info', destination: out.stream });
    logger.info({ req: { headers: { authorization: 'Bearer AAAA' } } }, 'a');
    logger.info({ req: { headers: { authorization: 'Bearer BBBB' } } }, 'b');
    const [a, b] = out.lines();
    const authA = (a?.req as { headers: { authorization: string } }).headers.authorization;
    const authB = (b?.req as { headers: { authorization: string } }).headers.authorization;
    expect(authA).toBe(authB);
  });

  it('level=silent 時不輸出任何內容', () => {
    const out = captureStream();
    const logger = createLogger({ level: 'silent', destination: out.stream });
    logger.error({ req: { headers: { authorization: 'Bearer X' } } }, 'boom');
    expect(out.raw()).toBe('');
  });
});

describe('[Security] request-logger（pino-http）實際請求不洩漏機敏 header', () => {
  it('Authorization 與 x-line-signature 不會出現在請求日誌；method / url / status 仍被記錄', async () => {
    const out = captureStream();
    const logger = createLogger({ level: 'info', destination: out.stream });
    const app = express();
    app.use(createRequestLogger(logger));
    app.get('/ping', (_req, res) => {
      res.json({ ok: true });
    });

    const response = await request(app)
      .get('/ping')
      .set('Authorization', 'Bearer eyJ.SECRET-ID-TOKEN.sig')
      .set('x-line-signature', 'SECRET-SIGNATURE==');
    expect(response.status).toBe(200);

    const raw = out.raw();
    expect(raw).not.toContain('SECRET-ID-TOKEN');
    expect(raw).not.toContain('SECRET-SIGNATURE');
    expect(raw).toContain('/ping');
    expect(raw).toContain('200');
  });

  it('請求處理失敗（500）時日誌同樣不洩漏機敏 header', async () => {
    const out = captureStream();
    const logger = createLogger({ level: 'info', destination: out.stream });
    const app = express();
    app.use(createRequestLogger(logger));
    app.get('/boom', (_req, res) => {
      res.status(500).json({ message: '系統錯誤' });
    });

    await request(app).get('/boom').set('Authorization', 'Bearer SECRET-ID-TOKEN');

    expect(out.raw()).not.toContain('SECRET-ID-TOKEN');
  });
});
