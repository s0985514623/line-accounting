/**
 * 記帳相關 LINE 回覆 builder（純函式）。
 *
 *  - buildRecordedReply：已記帳摘要 + 「刪除」postback（buttons template）。
 *  - buildCategoryQuickReply：未命中分類時的分類選擇提示 + Quick Reply（無狀態草稿，資料全放在 postback data）。
 * 依據：implementation-plan P3-4、R4–R6；ASM-05、ASM-06；specs/features/transaction/以文字訊息記帳.feature。
 */
import { ENTRY_TYPE_LABELS, LEDGER_LABELS, type EntryType, type Ledger } from '../../domain/enums';
import { encodeDelete, encodePick, isPostbackDataWithinLimit } from '../../domain/postback-codec';
import type { QuickReplyItem, TemplateMessage, TextMessage } from '../../ports/line-reply-gateway';
import { textMessage, truncateText } from './builders';
import { NOTE_TOO_LONG_TEXT } from './texts';

/** Quick Reply 按鈕數上限（LINE；ASM-06）。 */
export const MAX_QUICK_REPLY_ITEMS = 13;
/** Quick Reply label 長度上限（LINE；ASM-06）。 */
export const MAX_QUICK_REPLY_LABEL_LENGTH = 20;
/** template altText 長度上限（LINE）。 */
export const MAX_ALT_TEXT_LENGTH = 400;
/** buttons template 本文上限（無標題、無圖片時；LINE）。 */
export const MAX_BUTTONS_TEXT_LENGTH = 160;

const DELETE_LABEL = '刪除';

// ---- 已記帳摘要 -------------------------------------------------------------------------------

export interface RecordedSummaryInput {
  ledger: Ledger;
  entryType: EntryType;
  item: string;
  amount: number;
  categoryName: string;
  /** YYYY-MM-DD */
  occurredOn: string;
  transactionId: number;
}

/** 「已記帳｜{帳本}｜{收支}｜{項目} {金額} 元｜分類：{分類}｜{日期}」（金額不加千分位，ASM-02）。 */
function recordedSummaryText(input: RecordedSummaryInput): string {
  return [
    '已記帳',
    LEDGER_LABELS[input.ledger],
    ENTRY_TYPE_LABELS[input.entryType],
    `${input.item} ${input.amount} 元`,
    `分類：${input.categoryName}`,
    input.occurredOn,
  ].join('｜');
}

export function buildRecordedReply(input: RecordedSummaryInput): TemplateMessage {
  const summary = recordedSummaryText(input);
  return {
    type: 'template',
    altText: truncateText(summary, MAX_ALT_TEXT_LENGTH),
    template: {
      type: 'buttons',
      text: truncateText(summary, MAX_BUTTONS_TEXT_LENGTH),
      actions: [{ type: 'postback', label: DELETE_LABEL, data: encodeDelete(input.transactionId) }],
    },
  };
}

// ---- 分類 Quick Reply -------------------------------------------------------------------------

export interface CategoryChoice {
  id: number;
  name: string;
  isFallback: boolean;
}

export interface CategoryPromptInput {
  token: string;
  ledger: Ledger;
  entryType: EntryType;
  item: string;
  amount: number;
  /** YYYY-MM-DD */
  date: string;
  note: string | null;
  /** 呼叫端已依 id 升冪，且限同帳本同收支 */
  categories: readonly CategoryChoice[];
}

/**
 * 依 LINE 上限挑選按鈕（ASM-06）：未超過全部保留（維持輸入順序）；
 * 超過時取前 12 個一般分類 +「其他」放最後（沒有「其他」則取前 13 個）。
 */
export function selectCategories(categories: readonly CategoryChoice[]): readonly CategoryChoice[] {
  if (categories.length <= MAX_QUICK_REPLY_ITEMS) return categories;
  const fallback = categories.find((category) => category.isFallback);
  if (!fallback) return categories.slice(0, MAX_QUICK_REPLY_ITEMS);
  const regular = categories
    .filter((category) => !category.isFallback)
    .slice(0, MAX_QUICK_REPLY_ITEMS - 1);
  return [...regular, fallback];
}

export function buildCategoryQuickReply(input: CategoryPromptInput): TextMessage {
  const items: QuickReplyItem[] = selectCategories(input.categories).map((category) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: truncateText(category.name, MAX_QUICK_REPLY_LABEL_LENGTH),
      displayText: category.name,
      data: encodePick({
        token: input.token,
        ledger: input.ledger,
        entryType: input.entryType,
        item: input.item,
        amount: input.amount,
        date: input.date,
        note: input.note,
        categoryId: category.id,
      }),
    },
  }));

  if (items.some((item) => !isPostbackDataWithinLimit(item.action.data))) {
    return textMessage(NOTE_TOO_LONG_TEXT);
  }

  const prompt = textMessage(`請選擇「${input.item} ${input.amount} 元」的分類`);
  // 空的 quickReply.items 會被 LINE 拒絕（僅在資料異常、該組沒有任何分類時發生）
  return items.length > 0 ? { ...prompt, quickReply: { items } } : prompt;
}
