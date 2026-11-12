/**
 * webhook 事件分派：來源過濾 → 白名單 → 依事件類型交給 handler。
 *
 *  - 事件依序逐一處理，每個事件各自 try/catch：一個失敗不影響其他事件（HTTP 仍 200）。
 *    未預期例外 → log error（只記 eventId / type，不記個資）→ 若尚未用過 reply token，回「系統忙碌」。
 *  - `source.type !== 'user'`（group / room）一律忽略（ASM-11）。
 *  - 非白名單 userId（完全相等比對）：follow / message 回「此服務不開放使用」，postback 不回；不寫任何資料。
 *  - 白名單 message 事件交給 text-message-handler（非文字訊息回格式說明，ASM-11）。
 *  - 白名單 postback 事件交給 postback-handler（分類按鈕 / 刪除按鈕）。
 *  - unfollow 與未知事件類型靜默忽略。
 * 依據：implementation-plan P1-2、「錯誤處理登記表」；specs/api/api.yml `/webhook/line`。
 */
import type { Logger } from 'pino';
import type { LineReplyGateway } from '../ports/line-reply-gateway';
import type { FollowHandler } from './handlers/follow-handler';
import type { PostbackHandler } from './handlers/postback-handler';
import type { TextMessageHandler } from './handlers/text-message-handler';
import { textMessage } from './messages/builders';
import { NOT_ALLOWED_TEXT, SYSTEM_BUSY_TEXT } from './messages/texts';
import { EventReplier } from './reply-context';
import { WebhookEventSchema, type WebhookEvent } from './webhook-schema';

export interface EventHandlers {
  follow: Pick<FollowHandler, 'handle'>;
  message: Pick<TextMessageHandler, 'handle'>;
  postback: Pick<PostbackHandler, 'handle'>;
}

export interface EventDispatcherDeps {
  ownerUserId: string;
  gateway: LineReplyGateway;
  handlers: EventHandlers;
  logger: Logger;
}

/** 非白名單使用者會收到「不開放」回覆的事件類型。 */
const NOT_ALLOWED_REPLY_TYPES: ReadonlySet<string> = new Set(['follow', 'message']);

export class EventDispatcher {
  constructor(private readonly deps: EventDispatcherDeps) {}

  /** 依序處理所有事件；永不拋出。 */
  async dispatch(events: readonly unknown[]): Promise<void> {
    for (const raw of events) {
      await this.dispatchOne(raw);
    }
  }

  private async dispatchOne(raw: unknown): Promise<void> {
    const parsed = WebhookEventSchema.safeParse(raw);
    if (!parsed.success) {
      this.deps.logger.warn('webhook event has unexpected shape; ignored');
      return;
    }
    const event = parsed.data;
    const logger = this.deps.logger.child({
      webhookEventId: event.webhookEventId,
      eventType: event.type,
    });
    const replier = new EventReplier(this.deps.gateway, event.replyToken, logger);

    try {
      await this.route(event, replier, logger);
    } catch (error) {
      logger.error({ err: error }, 'webhook event handling failed');
      if (replier.canReply) await this.replySystemBusy(replier, logger);
    }
  }

  private async route(event: WebhookEvent, replier: EventReplier, logger: Logger): Promise<void> {
    const userId = event.source?.type === 'user' ? event.source.userId : undefined;
    if (userId === undefined) {
      logger.debug('non-user source; ignored');
      return;
    }

    if (userId !== this.deps.ownerUserId) {
      if (NOT_ALLOWED_REPLY_TYPES.has(event.type)) {
        await replier.reply([textMessage(NOT_ALLOWED_TEXT)]);
      }
      return;
    }

    switch (event.type) {
      case 'follow':
        await this.deps.handlers.follow.handle(replier);
        return;
      case 'message':
        if (event.message === undefined) {
          logger.warn('message event without message; ignored');
          return;
        }
        await this.deps.handlers.message.handle(event.message, replier);
        return;
      case 'postback':
        if (event.postback === undefined) {
          logger.warn('postback event without postback; ignored');
          return;
        }
        await this.deps.handlers.postback.handle(event.postback, replier);
        return;
      default:
        // unfollow 與未知事件類型不處理
        logger.debug('event type not handled; ignored');
    }
  }

  private async replySystemBusy(replier: EventReplier, logger: Logger): Promise<void> {
    try {
      await replier.reply([textMessage(SYSTEM_BUSY_TEXT)]);
    } catch (error) {
      logger.error({ err: error }, 'failed to send system busy reply');
    }
  }
}
