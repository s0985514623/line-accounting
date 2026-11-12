/**
 * LINE webhook 請求內容的 zod schema（只驗證本服務用到的欄位，其餘欄位略過）。
 * 依據：specs/api/api.yml `LineWebhookBody`。
 */
import { z } from 'zod';

/** 外層 body：events 逐一在 dispatcher 內各自驗證，單一事件格式不符不影響其他事件。 */
export const WebhookBodySchema = z.object({
  destination: z.string().optional(),
  events: z.array(z.unknown()),
});

export type WebhookBody = z.infer<typeof WebhookBodySchema>;

const EventSourceSchema = z.object({
  type: z.string(),
  userId: z.string().optional(),
});

export const WebhookEventSchema = z.object({
  type: z.string(),
  webhookEventId: z.string().optional(),
  replyToken: z.string().optional(),
  source: EventSourceSchema.optional(),
  message: z.object({ type: z.string(), text: z.string().optional() }).optional(),
  postback: z.object({ data: z.string() }).optional(),
});

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
