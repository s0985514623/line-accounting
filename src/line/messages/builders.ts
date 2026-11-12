/**
 * LINE 訊息 builder 共用小工具（純函式）。
 */
import type { TextMessage } from '../../ports/line-reply-gateway';

/** 建立不含 Quick Reply 的純文字訊息。 */
export function textMessage(text: string): TextMessage {
  return { type: 'text', text };
}
