/**
 * 單一 webhook 事件的回覆入口。綁定該事件的 reply token，並記錄是否已嘗試回覆
 * （reply token 一次性：已嘗試過就不再補送「系統忙碌」）。
 */
import type { Logger } from 'pino';
import type { LineMessage, LineReplyGateway } from '../ports/line-reply-gateway';

export interface Replier {
  reply(messages: LineMessage[]): Promise<void>;
}

export class EventReplier implements Replier {
  private attempted = false;

  constructor(
    private readonly gateway: LineReplyGateway,
    private readonly replyToken: string | undefined,
    private readonly logger: Logger,
  ) {}

  /** 是否還能回覆（有 token 且尚未使用）。 */
  get canReply(): boolean {
    return this.replyToken !== undefined && !this.attempted;
  }

  async reply(messages: LineMessage[]): Promise<void> {
    if (this.replyToken === undefined) {
      this.logger.warn('event has no reply token; reply skipped');
      return;
    }
    this.attempted = true;
    await this.gateway.reply(this.replyToken, messages);
  }
}
