/**
 * 每月固定收支的 LINE 訊息 builder（純函式）。
 *
 *  - buildOccurrenceNotice：到期推播（buttons template）
 *      「固定支出到期｜個人｜房租 15000 元｜分類：居住｜2026-12-05」
 *      按鈕：確認入帳（postback rconfirm）／修改金額（LIFF /recurring/occurrences/{id}）／略過（postback rskip）
 *  - buildSkippedReply：「已略過：房租 15000 元（2026-12-05）」
 *  - buildRecurringListReplies：「固定」指令 → 規則清單文字 + 管理頁連結
 */
import { ENTRY_TYPE_LABELS, LEDGER_LABELS } from '../../domain/enums';
import { encodeOccurrenceConfirm, encodeOccurrenceSkip } from '../../domain/postback-codec';
import type { LineMessage, TemplateMessage } from '../../ports/line-reply-gateway';
import type {
  RecurringEntryDetail,
  RecurringOccurrenceDetail,
} from '../../repositories/recurring-repository';
import { textMessage, truncateText } from './builders';
import { MAX_ALT_TEXT_LENGTH, MAX_BUTTONS_TEXT_LENGTH } from './entry-replies';
import { NO_RECURRING_TEXT } from './texts';

/** LINE 文字訊息上限（保守估計）。 */
const MAX_TEXT_LENGTH = 5000;

/** LIFF 固定收支頁連結：https://liff.line.me/{liffId}/recurring[/occurrences/{id}] */
export function buildRecurringUrl(liffId: string, occurrenceId?: number): string {
  const base = `https://liff.line.me/${encodeURIComponent(liffId)}/recurring`;
  return occurrenceId === undefined ? base : `${base}/occurrences/${occurrenceId}`;
}

function noticeText(occurrence: RecurringOccurrenceDetail): string {
  return [
    `固定${ENTRY_TYPE_LABELS[occurrence.entryType]}到期`,
    LEDGER_LABELS[occurrence.ledger],
    `${occurrence.item} ${occurrence.amount} 元`,
    `分類：${occurrence.categoryName}`,
    occurrence.dueOn,
  ].join('｜');
}

export function buildOccurrenceNotice(
  occurrence: RecurringOccurrenceDetail,
  liffId: string,
): TemplateMessage {
  const text = noticeText(occurrence);
  return {
    type: 'template',
    altText: truncateText(text, MAX_ALT_TEXT_LENGTH),
    template: {
      type: 'buttons',
      text: truncateText(text, MAX_BUTTONS_TEXT_LENGTH),
      actions: [
        {
          type: 'postback',
          label: '確認入帳',
          data: encodeOccurrenceConfirm(occurrence.id),
          displayText: '確認入帳',
        },
        { type: 'uri', label: '修改金額', uri: buildRecurringUrl(liffId, occurrence.id) },
        {
          type: 'postback',
          label: '略過',
          data: encodeOccurrenceSkip(occurrence.id),
          displayText: '略過',
        },
      ],
    },
  };
}

export function buildSkippedReply(occurrence: RecurringOccurrenceDetail): LineMessage {
  return textMessage(`已略過：${occurrence.item} ${occurrence.amount} 元（${occurrence.dueOn}）`);
}

function entryLine(entry: RecurringEntryDetail): string {
  const sign = entry.entryType === 'income' ? '+' : '';
  const paused = entry.active ? '' : '（停用）';
  return `・${entry.dayOfMonth} 號 ${LEDGER_LABELS[entry.ledger]} ${sign}${entry.item} ${entry.amount} 元${paused}`;
}

/** 「固定」指令回覆：[清單文字, 管理頁連結]。 */
export function buildRecurringListReplies(
  entries: readonly RecurringEntryDetail[],
  pendingCount: number,
  liffId: string,
): LineMessage[] {
  const lines =
    entries.length === 0 ? [NO_RECURRING_TEXT] : ['每月固定收支：', ...entries.map(entryLine)];
  if (pendingCount > 0) lines.push(`待確認：${pendingCount} 筆`);

  const link: TemplateMessage = {
    type: 'template',
    altText: '管理固定收支',
    template: {
      type: 'buttons',
      text: pendingCount > 0 ? '新增、編輯固定收支，或確認待入帳項目' : '新增、編輯固定收支',
      actions: [{ type: 'uri', label: '管理固定收支', uri: buildRecurringUrl(liffId) }],
    },
  };
  return [textMessage(truncateText(lines.join('\n'), MAX_TEXT_LENGTH)), link];
}
