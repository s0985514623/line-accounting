/**
 * 白名單使用者的 message 事件：文字記帳。
 *
 *  - 非文字訊息（貼圖、圖片…）→ 回格式說明（ASM-11）。
 *  - 單行：
 *    - 解析錯誤 → 對應規格文字（格式說明 / 金額必須為正整數 / 金額超過上限 / 項目最多 50 字 / 日期…）。
 *    - 日期前綴（今天 / 昨天 / 前天 / M/D / YYYY/M/D）以 Asia/Taipei 的今天換算；不存在或晚於今天 → 錯誤。
 *    - 記帳成功 → 已記帳摘要 + 刪除按鈕；未命中分類 → 分類 Quick Reply（data 過長時改回「備註太長…」）。
 *    - 月度摘要指令（本月 / 上月 / 公 本月 / 公 上月）→ [摘要文字, 圖表連結]（P5）。
 *    - 「待分類」→ 重新顯示最早一筆批次待分類項目的分類 Quick Reply。
 *  - 多行（去掉空白行後 ≥ 2 行）→ 批次記帳：
 *    - 超過 MAX_BATCH_LINES 行 → 整批不記帳。
 *    - 每行獨立解析；錯誤行列出原因、其餘照記。
 *    - 沒寫日期的行沿用上方最近一個有寫日期的行（之前都沒有 → 今天）；該日期有誤時，沿用的行也不記帳。
 *    - 命中分類者直接記帳，未命中者依行序逐筆以 Quick Reply 詢問。
 * 依據：specs/features/transaction/以文字訊息記帳.feature、批次文字記帳.feature、
 *       specs/features/report/查詢月度文字摘要.feature；implementation-plan P3-6、P5、DF-1。
 */
import {
  resolveEntryDate,
  resolveSummaryMonth,
  todayInTaipei,
  type EntryDateSpec,
} from '../../domain/date-utils';
import { parseTextEntry, type ParseResult, type TextEntry } from '../../domain/text-entry-parser';
import type { Clock } from '../../ports/clock';
import type { LineMessage } from '../../ports/line-reply-gateway';
import type { ReportService } from '../../services/report-service';
import type { BatchEntryInput, TransactionService } from '../../services/transaction-service';
import {
  buildBatchSummary,
  buildPendingPrompt,
  type BatchLineError,
} from '../messages/batch-replies';
import { textMessage } from '../messages/builders';
import { buildCategoryQuickReply, buildRecordedReply } from '../messages/entry-replies';
import { buildSummaryReplies } from '../messages/summary-replies';
import {
  AMOUNT_NOT_POSITIVE_INTEGER_TEXT,
  AMOUNT_TOO_LARGE_TEXT,
  BATCH_LINE_COMMAND_TEXT,
  BATCH_LINE_FORMAT_ERROR_TEXT,
  BATCH_TOO_MANY_LINES_TEXT,
  DATE_FUTURE_TEXT,
  DATE_INVALID_TEXT,
  FORMAT_HELP_TEXT,
  ITEM_TOO_LONG_TEXT,
  MAX_BATCH_LINES,
  batchInheritedDateErrorText,
  NO_PENDING_TEXT,
} from '../messages/texts';
import type { Replier } from '../reply-context';

/** webhook message 事件的 message 欄位（只取用到的部分）。 */
export interface IncomingMessage {
  type: string;
  text?: string | undefined;
}

type SummaryCommand = Extract<ParseResult, { kind: 'summary' }>;

type ParseErrorKind = Exclude<ParseResult['kind'], 'entry' | 'summary' | 'resumePending'>;

const PARSE_ERROR_TEXTS: Readonly<Record<ParseErrorKind, string>> = {
  formatError: FORMAT_HELP_TEXT,
  dateError: DATE_INVALID_TEXT,
  amountError: AMOUNT_NOT_POSITIVE_INTEGER_TEXT,
  amountTooLarge: AMOUNT_TOO_LARGE_TEXT,
  itemTooLong: ITEM_TOO_LONG_TEXT,
};

/** 批次逐行錯誤：格式錯誤改用短訊息（完整格式說明在摘要後另附一次）。 */
const BATCH_PARSE_ERROR_TEXTS: Readonly<Record<ParseErrorKind, string>> = {
  ...PARSE_ERROR_TEXTS,
  formatError: BATCH_LINE_FORMAT_ERROR_TEXT,
};

const DATE_ERROR_TEXTS = {
  invalid: DATE_INVALID_TEXT,
  future: DATE_FUTURE_TEXT,
} as const;

type ResolvedEntry =
  { ok: true; entry: TextEntry; occurredOn: string } | { ok: false; message: string };

export interface TextMessageHandlerDeps {
  transactions: Pick<
    TransactionService,
    'createFromText' | 'createBatchFromText' | 'resumePending'
  >;
  reports: Pick<ReportService, 'getMonthlyReport'>;
  clock: Clock;
  /** LIFF app ID（圖表連結用） */
  liffId: string;
}

export class TextMessageHandler {
  constructor(private readonly deps: TextMessageHandlerDeps) {}

  async handle(message: IncomingMessage, replier: Replier): Promise<void> {
    if (message.type !== 'text' || message.text === undefined) {
      await replier.reply([textMessage(FORMAT_HELP_TEXT)]);
      return;
    }

    const lines = message.text.split(/\r\n|\r|\n/);
    const nonEmptyLines = lines.filter((line) => line.normalize('NFKC').trim() !== '');
    if (nonEmptyLines.length >= 2) {
      await replier.reply(await this.handleBatch(lines));
      return;
    }

    const parsed = parseTextEntry(message.text);
    switch (parsed.kind) {
      case 'summary':
        await replier.reply(await this.buildSummary(parsed));
        return;
      case 'resumePending': {
        const prompt = await this.deps.transactions.resumePending();
        await replier.reply([prompt ? buildPendingPrompt(prompt) : textMessage(NO_PENDING_TEXT)]);
        return;
      }
      case 'entry': {
        const resolved = this.resolveDate(parsed);
        await replier.reply([
          resolved.ok
            ? await this.recordEntry(resolved.entry, resolved.occurredOn)
            : textMessage(resolved.message),
        ]);
        return;
      }
      default:
        await replier.reply([textMessage(PARSE_ERROR_TEXTS[parsed.kind])]);
    }
  }

  private async handleBatch(lines: readonly string[]): Promise<LineMessage[]> {
    const numbered = lines
      .map((text, index) => ({ text, line: index + 1 }))
      .filter(({ text }) => text.normalize('NFKC').trim() !== '');
    if (numbered.length > MAX_BATCH_LINES) return [textMessage(BATCH_TOO_MANY_LINES_TEXT)];

    const entries: BatchEntryInput[] = [];
    const errors: BatchLineError[] = [];
    // 沒寫日期的行沿用上方最近一個「有寫日期」的行；該日期有誤時，沿用它的行也不記帳
    let carried: { ok: true; date: EntryDateSpec } | { ok: false; line: number } | null = null;
    for (const { text, line } of numbered) {
      const parsed = parseTextEntry(text);
      if (parsed.kind === 'summary' || parsed.kind === 'resumePending') {
        errors.push({ line, message: BATCH_LINE_COMMAND_TEXT });
        continue;
      }
      if (parsed.kind === 'dateError') carried = { ok: false, line };
      if (parsed.kind !== 'entry') {
        errors.push({ line, message: BATCH_PARSE_ERROR_TEXTS[parsed.kind] });
        continue;
      }
      if (parsed.date !== null) {
        carried = { ok: true, date: parsed.date };
      } else if (carried?.ok === false) {
        errors.push({ line, message: batchInheritedDateErrorText(carried.line) });
        continue;
      }
      const resolved = this.resolveDate(
        parsed.date === null && carried?.ok ? { ...parsed, date: carried.date } : parsed,
      );
      if (!resolved.ok) {
        if (parsed.date !== null) carried = { ok: false, line };
        errors.push({ line, message: resolved.message });
        continue;
      }
      const { kind: _kind, date: _date, ...entry } = resolved.entry;
      entries.push({ ...entry, line, occurredOn: resolved.occurredOn });
    }

    const result =
      entries.length > 0
        ? await this.deps.transactions.createBatchFromText(entries)
        : { recorded: [], pendingCount: 0, next: null };

    const replies: LineMessage[] = [
      buildBatchSummary({ recorded: result.recorded, errors, pendingCount: result.pendingCount }),
    ];
    if (errors.some((error) => error.message === BATCH_LINE_FORMAT_ERROR_TEXT)) {
      replies.push(textMessage(FORMAT_HELP_TEXT));
    }
    if (result.next) replies.push(buildPendingPrompt(result.next));
    return replies;
  }

  private resolveDate(entry: TextEntry): ResolvedEntry {
    const today = todayInTaipei(this.deps.clock.now());
    const resolved = resolveEntryDate(entry.date, today);
    if (!resolved.ok) return { ok: false, message: DATE_ERROR_TEXTS[resolved.reason] };
    return { ok: true, entry, occurredOn: resolved.date };
  }

  private async buildSummary(command: SummaryCommand): Promise<LineMessage[]> {
    const month = resolveSummaryMonth(command.period, this.deps.clock.now());
    const report = await this.deps.reports.getMonthlyReport(command.ledger, month);
    return buildSummaryReplies(report, this.deps.liffId);
  }

  private async recordEntry(entry: TextEntry, occurredOn: string): Promise<LineMessage> {
    const { kind: _kind, date: _date, ...input } = entry;
    const result = await this.deps.transactions.createFromText({ ...input, occurredOn });
    if (result.kind === 'recorded') {
      return buildRecordedReply({
        ledger: entry.ledger,
        entryType: entry.entryType,
        item: entry.item,
        amount: entry.amount,
        categoryName: result.categoryName,
        occurredOn: result.occurredOn,
        transactionId: result.transactionId,
      });
    }
    return buildCategoryQuickReply({
      token: result.token,
      ledger: entry.ledger,
      entryType: entry.entryType,
      item: entry.item,
      amount: entry.amount,
      date: result.date,
      note: entry.note,
      categories: result.categories,
    });
  }
}
