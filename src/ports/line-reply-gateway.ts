/**
 * LINE Reply 閘道（測試替身注入點）。
 *
 * LineMessage 為 LINE Messaging API 訊息物件的子集（domain 層自有型別，結構同 SDK JSON），
 * 由 adapter 轉換為 SDK 型別送出。
 */

export interface PostbackAction {
  type: 'postback';
  label: string;
  data: string;
  displayText?: string;
}

export interface UriAction {
  type: 'uri';
  label: string;
  uri: string;
}

export type TemplateAction = PostbackAction | UriAction;

export interface QuickReplyItem {
  type: 'action';
  action: PostbackAction;
}

export interface TextMessage {
  type: 'text';
  text: string;
  quickReply?: { items: QuickReplyItem[] };
}

export interface TemplateMessage {
  type: 'template';
  altText: string;
  template: {
    type: 'buttons' | 'confirm';
    text: string;
    actions: TemplateAction[];
  };
}

export type LineMessage = TextMessage | TemplateMessage;

export interface LineReplyGateway {
  /** 以 reply token 回覆訊息（token 一次性，失敗不重試）。 */
  reply(replyToken: string, messages: LineMessage[]): Promise<void>;
}
