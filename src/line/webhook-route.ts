/**
 * POST /webhook/line
 *
 *  1. `express.raw` 取得原始位元組（R7：簽章必須針對原始 body，不可先經 express.json）。
 *  2. 以 channel secret 驗證 x-line-signature（HMAC-SHA256 base64）；缺 / 錯 → 401，不處理任何事件。
 *  3. 驗簽通過才 JSON.parse + zod 驗證；不合法 → 400。
 *  4. 同步逐一分派事件後回 200（業務結果以 LINE reply 表達，一律 200；`events: []` 為 console Verify）。
 */
import { validateSignature } from '@line/bot-sdk';
import express, { Router } from 'express';
import type { Logger } from 'pino';
import { asyncHandler } from '../http/async-handler';
import type { EventDispatcher } from './event-dispatcher';
import { WebhookBodySchema, type WebhookBody } from './webhook-schema';

export const WEBHOOK_PATH = '/webhook/line';
const SIGNATURE_HEADER = 'x-line-signature';
/** LINE webhook body 實務上遠小於此；超過由 body-parser 回 413。 */
const BODY_LIMIT = '1mb';

export interface WebhookRouteDeps {
  channelSecret: string;
  dispatcher: Pick<EventDispatcher, 'dispatch'>;
  logger: Logger;
}

function isValidSignature(rawBody: Buffer, channelSecret: string, signature: string): boolean {
  try {
    return validateSignature(rawBody, channelSecret, signature);
  } catch {
    return false;
  }
}

/** 驗簽通過後才呼叫：JSON 解析 + 結構驗證；不合法回 null。 */
function parseBody(rawBody: Buffer): WebhookBody | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }
  const result = WebhookBodySchema.safeParse(json);
  return result.success ? result.data : null;
}

export function createWebhookRouter(deps: WebhookRouteDeps): Router {
  const router = Router();

  router.post(
    WEBHOOK_PATH,
    express.raw({ type: '*/*', limit: BODY_LIMIT }),
    asyncHandler(async (req, res) => {
      const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const signature = req.get(SIGNATURE_HEADER);

      if (!signature || !isValidSignature(rawBody, deps.channelSecret, signature)) {
        deps.logger.warn('webhook signature verification failed');
        res.status(401).json({ message: '簽章驗證失敗', violationType: 'UNAUTHENTICATED' });
        return;
      }

      const body = parseBody(rawBody);
      if (!body) {
        deps.logger.warn('webhook body is not a valid LINE webhook JSON');
        res
          .status(400)
          .json({ message: '請求內容不是合法的 JSON', violationType: 'INVALID_ARGUMENT' });
        return;
      }

      await deps.dispatcher.dispatch(body.events);
      res.status(200).json({});
    }),
  );

  return router;
}
