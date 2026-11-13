/**
 * 月度文字摘要的 LINE 回覆 builder（純函式）。
 *
 * 摘要文字格式（ASM-02；以 '\n' 連接、結尾無換行、金額不加千分位）：
 *   【個人】2026-11 月度摘要
 *   收入合計：50000 元
 *   支出合計：400 元
 *   結餘：49600 元
 *   支出分類：                 <- 無支出時此區塊整個省略
 *   ・餐飲 300 元（75.0%）
 *   ・其他 100 元（25.0%）
 *   收入分類：                 <- 無收入時此區塊整個省略
 *   ・薪資 50000 元（100.0%）
 * 第二則訊息為 buttons template，單一 URI action「查看圖表」→ LIFF 圖表頁（同帳本、同月份）。
 * 依據：implementation-plan P5-4；specs/features/report/查詢月度文字摘要.feature。
 */
import { LEDGER_LABELS, type Ledger } from '../../domain/enums';
import type { CategoryShare, MonthlyReport } from '../../domain/monthly-report';
import type { TemplateMessage, TextMessage } from '../../ports/line-reply-gateway';
import { textMessage, truncateText } from './builders';
import { MAX_ALT_TEXT_LENGTH, MAX_BUTTONS_TEXT_LENGTH } from './entry-replies';

const CHART_LABEL = '查看圖表';

function categoryLine(share: CategoryShare): string {
  return `・${share.categoryName} ${share.amount} 元（${share.ratio.toFixed(1)}%）`;
}

/** 月度摘要文字（依 report 各分類清單既有順序輸出，不重新排序）。 */
export function buildSummaryReply(report: MonthlyReport): TextMessage {
  const lines = [
    `【${LEDGER_LABELS[report.ledger]}】${report.month} 月度摘要`,
    `收入合計：${report.incomeTotal} 元`,
    `支出合計：${report.expenseTotal} 元`,
    `結餘：${report.balance} 元`,
  ];
  if (report.expenseByCategory.length > 0) {
    lines.push('支出分類：', ...report.expenseByCategory.map(categoryLine));
  }
  if (report.incomeByCategory.length > 0) {
    lines.push('收入分類：', ...report.incomeByCategory.map(categoryLine));
  }
  return textMessage(lines.join('\n'));
}

/** LIFF 圖表頁連結：https://liff.line.me/{liffId}/chart?month={month}&ledger={ledger} */
export function buildChartUrl(liffId: string, ledger: Ledger, month: string): string {
  const query = new URLSearchParams({ month, ledger });
  return `https://liff.line.me/${encodeURIComponent(liffId)}/chart?${query.toString()}`;
}

/** 圖表連結（buttons template，單一 URI action「查看圖表」）。 */
export function buildChartLinkReply(
  report: Pick<MonthlyReport, 'ledger' | 'month'>,
  liffId: string,
): TemplateMessage {
  const text = `${LEDGER_LABELS[report.ledger]} ${report.month} 收支圖表`;
  return {
    type: 'template',
    altText: truncateText(`查看圖表：${text}`, MAX_ALT_TEXT_LENGTH),
    template: {
      type: 'buttons',
      text: truncateText(text, MAX_BUTTONS_TEXT_LENGTH),
      actions: [
        {
          type: 'uri',
          label: CHART_LABEL,
          uri: buildChartUrl(liffId, report.ledger, report.month),
        },
      ],
    },
  };
}

/** 同一次 reply 的兩則訊息：[摘要文字, 圖表連結]。 */
export function buildSummaryReplies(
  report: MonthlyReport,
  liffId: string,
): [TextMessage, TemplateMessage] {
  return [buildSummaryReply(report), buildChartLinkReply(report, liffId)];
}
