/**
 * LINE 訊息 builder 共用小工具（純函式）。
 */
import type { TextMessage } from '../../ports/line-reply-gateway';

const ELLIPSIS = '…';

/** 建立不含 Quick Reply 的純文字訊息。 */
export function textMessage(text: string): TextMessage {
  return { type: 'text', text };
}

/**
 * 將文字截斷到 `.length <= maxLength`（UTF-16 長度，LINE 長度上限的保守估計）。
 * 未超過時原樣回傳；超過時保留前段並以「…」結尾，且不切開 surrogate pair（Emoji）。
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const budget = maxLength - ELLIPSIS.length;
  let result = '';
  for (const char of text) {
    if (result.length + char.length > budget) break;
    result += char;
  }
  return result + ELLIPSIS;
}
