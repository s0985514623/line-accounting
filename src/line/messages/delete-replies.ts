/**
 * 刪除流程的 LINE 回覆 builder（純函式）。
 *
 *  - buildDeleteConfirmReply：「確定刪除？{項目} {金額} 元（{日期}）」confirm template，按鈕依序「確定」「取消」。
 *  - buildDeletedReply：「已刪除：{項目} {金額} 元（{日期}）」。
 * 金額不加千分位（ASM-02）。
 * 依據：implementation-plan P4；specs/features/transaction/請求刪除記帳紀錄.feature、確認刪除記帳紀錄.feature。
 */
import { encodeCancel, encodeConfirm } from '../../domain/postback-codec';
import type { TemplateMessage, TextMessage } from '../../ports/line-reply-gateway';
import { textMessage, truncateText } from './builders';
import { MAX_ALT_TEXT_LENGTH } from './entry-replies';

/** confirm template 本文上限（LINE）。 */
export const MAX_CONFIRM_TEXT_LENGTH = 240;

const CONFIRM_LABEL = '確定';
const CANCEL_LABEL = '取消';

export interface DeleteSummaryInput {
  transactionId: number;
  item: string;
  amount: number;
  /** YYYY-MM-DD */
  occurredOn: string;
}

/** 「{項目} {金額} 元（{日期}）」 */
function recordLabel(input: Omit<DeleteSummaryInput, 'transactionId'>): string {
  return `${input.item} ${input.amount} 元（${input.occurredOn}）`;
}

export function buildDeleteConfirmReply(input: DeleteSummaryInput): TemplateMessage {
  const text = `確定刪除？${recordLabel(input)}`;
  return {
    type: 'template',
    altText: truncateText(text, MAX_ALT_TEXT_LENGTH),
    template: {
      type: 'confirm',
      text: truncateText(text, MAX_CONFIRM_TEXT_LENGTH),
      actions: [
        { type: 'postback', label: CONFIRM_LABEL, data: encodeConfirm(input.transactionId) },
        { type: 'postback', label: CANCEL_LABEL, data: encodeCancel(input.transactionId) },
      ],
    },
  };
}

export function buildDeletedReply(input: Omit<DeleteSummaryInput, 'transactionId'>): TextMessage {
  return textMessage(`已刪除：${recordLabel(input)}`);
}
