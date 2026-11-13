/**
 * LineReplyGateway 的正式實作：domain LineMessage → @line/bot-sdk 訊息型別 → Reply API。
 *
 *  - 逐欄位重建 SDK 物件（不改動輸入、不夾帶多餘欄位；未設定的 optional 欄位不出現）。
 *  - Reply API 失敗（token 過期 / 4xx / 5xx / 網路）只 log error，不拋出、不重試（reply token 一次性）。
 * 依據：implementation-plan P1-3、「錯誤處理登記表」line-messaging-gateway.reply。
 */
import { HTTPFetchError, type messagingApi } from '@line/bot-sdk';
import type { Logger } from 'pino';
import type {
  LineMessage,
  LinePushGateway,
  LineReplyGateway,
  PostbackAction,
  QuickReplyItem,
  TemplateAction,
  TemplateMessage,
  TextMessage,
} from '../ports/line-reply-gateway';

/** 結構相容 @line/bot-sdk 的 messagingApi.MessagingApiClient（測試可注入替身）。 */
export interface ReplyMessageClient {
  replyMessage(request: { replyToken: string; messages: unknown[] }): Promise<unknown>;
  pushMessage?(request: { to: string; messages: unknown[] }): Promise<unknown>;
}

function toSdkPostbackAction(action: PostbackAction): messagingApi.PostbackAction {
  return {
    type: 'postback',
    label: action.label,
    data: action.data,
    ...(action.displayText !== undefined && { displayText: action.displayText }),
  };
}

function toSdkAction(action: TemplateAction): messagingApi.Action {
  if (action.type === 'postback') return toSdkPostbackAction(action);
  return { type: 'uri', label: action.label, uri: action.uri };
}

function toSdkQuickReplyItem(item: QuickReplyItem): messagingApi.QuickReplyItem {
  return { type: 'action', action: toSdkPostbackAction(item.action) };
}

function toSdkTextMessage(message: TextMessage): messagingApi.TextMessage {
  return {
    type: 'text',
    text: message.text,
    ...(message.quickReply !== undefined && {
      quickReply: { items: message.quickReply.items.map(toSdkQuickReplyItem) },
    }),
  };
}

function toSdkTemplateMessage(message: TemplateMessage): messagingApi.TemplateMessage {
  const { template } = message;
  return {
    type: 'template',
    altText: message.altText,
    template: {
      type: template.type,
      text: template.text,
      actions: template.actions.map(toSdkAction),
    },
  };
}

/** domain 訊息 → SDK 訊息（純函式）。 */
export function toSdkMessage(message: LineMessage): messagingApi.Message {
  return message.type === 'text' ? toSdkTextMessage(message) : toSdkTemplateMessage(message);
}

/** 只擷取可安全記錄的錯誤資訊（不含 reply token、訊息內容）。 */
function describeReplyError(error: unknown): Record<string, unknown> {
  if (error instanceof HTTPFetchError) {
    return {
      errorName: error.name,
      status: error.status,
      statusText: error.statusText,
      lineRequestId: error.headers.get('x-line-request-id') ?? undefined,
    };
  }
  if (error instanceof Error) return { errorName: error.name, errorMessage: error.message };
  return { errorType: typeof error };
}

export class LineMessagingGateway implements LineReplyGateway, LinePushGateway {
  constructor(
    private readonly client: ReplyMessageClient,
    private readonly logger: Logger,
  ) {}

  async reply(replyToken: string, messages: LineMessage[]): Promise<void> {
    try {
      await this.client.replyMessage({ replyToken, messages: messages.map(toSdkMessage) });
    } catch (error) {
      this.logger.error(
        { ...describeReplyError(error), messageCount: messages.length },
        'LINE reply failed',
      );
    }
  }

  async push(to: string, messages: LineMessage[]): Promise<boolean> {
    if (!this.client.pushMessage) {
      this.logger.error('LINE push not supported by client');
      return false;
    }
    try {
      await this.client.pushMessage({ to, messages: messages.map(toSdkMessage) });
      return true;
    } catch (error) {
      this.logger.error(
        { ...describeReplyError(error), messageCount: messages.length },
        'LINE push failed',
      );
      return false;
    }
  }
}
