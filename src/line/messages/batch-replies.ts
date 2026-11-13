/**
 * LINE 多行批次記帳的回覆 builder（純函式）。
 *
 *  - buildBatchSummary：批次結果（已記帳清單、失敗行、待分類筆數）。
 *  - buildPendingPrompt：下一筆待分類項目的分類 Quick Reply（data = action=bpick&id=&categoryId=）。
 *  - buildAutoRecordedText：選完分類後，同批次因新關鍵字而自動記帳的項目。
 */
import { ENTRY_TYPE_LABELS, LEDGER_LABELS } from '../../domain/enums';
import { encodeBatchPick } from '../../domain/postback-codec';
import type { QuickReplyItem, TextMessage } from '../../ports/line-reply-gateway';
import type { PendingPrompt, RecordedEntry } from '../../services/transaction-service';
import { textMessage, truncateText } from './builders';
import { MAX_QUICK_REPLY_LABEL_LENGTH, selectCategories } from './entry-replies';

/** LINE 文字訊息長度上限。 */
const MAX_TEXT_LENGTH = 5000;

export interface BatchLineError {
  /** 原訊息行號（1 起算） */
  line: number;
  message: string;
}

export interface BatchSummaryInput {
  recorded: readonly RecordedEntry[];
  errors: readonly BatchLineError[];
  pendingCount: number;
}

/** 「・個人支出｜午餐 120 元｜餐飲｜2026-11-10」 */
function recordedLine(entry: RecordedEntry): string {
  return [
    `・${LEDGER_LABELS[entry.ledger]}${ENTRY_TYPE_LABELS[entry.entryType]}`,
    `${entry.item} ${entry.amount} 元`,
    entry.categoryName,
    entry.occurredOn,
  ].join('｜');
}

export function buildBatchSummary(input: BatchSummaryInput): TextMessage {
  const counts = [`已記帳 ${input.recorded.length} 筆`];
  if (input.pendingCount > 0) counts.push(`待分類 ${input.pendingCount} 筆`);
  if (input.errors.length > 0) counts.push(`失敗 ${input.errors.length} 行`);

  const lines = [`批次記帳：${counts.join('、')}`, ...input.recorded.map(recordedLine)];
  if (input.errors.length > 0) {
    lines.push('', '以下各行未記帳，請修正後重新傳送：');
    lines.push(...input.errors.map((error) => `・第 ${error.line} 行：${error.message}`));
  }
  return textMessage(truncateText(lines.join('\n'), MAX_TEXT_LENGTH));
}

export function buildAutoRecordedText(entries: readonly RecordedEntry[]): TextMessage {
  return textMessage(
    truncateText(
      ['已依新學到的分類自動記帳：', ...entries.map(recordedLine)].join('\n'),
      MAX_TEXT_LENGTH,
    ),
  );
}

/** 「（待分類 3 筆）請選擇「咖啡 80 元｜2026-11-10」的分類」+ 分類 Quick Reply。 */
export function buildPendingPrompt(prompt: PendingPrompt): TextMessage {
  const items: QuickReplyItem[] = selectCategories(prompt.categories).map((category) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: truncateText(category.name, MAX_QUICK_REPLY_LABEL_LENGTH),
      displayText: category.name,
      data: encodeBatchPick({ pendingId: prompt.pendingId, categoryId: category.id }),
    },
  }));
  const message = textMessage(
    `（待分類 ${prompt.remaining} 筆）請選擇「${LEDGER_LABELS[prompt.ledger]}${ENTRY_TYPE_LABELS[prompt.entryType]}｜${prompt.item} ${prompt.amount} 元｜${prompt.occurredOn}」的分類`,
  );
  return items.length > 0 ? { ...message, quickReply: { items } } : message;
}
