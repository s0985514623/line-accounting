/**
 * 白名單使用者的 message 事件：文字記帳。
 *
 *  - 非文字訊息（貼圖、圖片…）→ 回格式說明（ASM-11）。
 *  - 解析錯誤 → 對應規格文字（格式說明 / 金額必須為正整數 / 金額超過上限 / 項目最多 50 字）。
 *  - 記帳成功 → 已記帳摘要 + 刪除按鈕；未命中分類 → 分類 Quick Reply（data 過長時改回「備註太長…」）。
 *  - 月度摘要指令（本月 / 上月 / 公 本月 / 公 上月）由 P5 實作；目前只辨識、不回覆。
 * 依據：specs/features/transaction/以文字訊息記帳.feature；implementation-plan P3-6、DF-1。
 */
import type { Logger } from 'pino';
import { parseTextEntry, type ParseResult, type TextEntry } from '../../domain/text-entry-parser';
import type { LineMessage } from '../../ports/line-reply-gateway';
import type { TransactionService } from '../../services/transaction-service';
import { textMessage } from '../messages/builders';
import { buildCategoryQuickReply, buildRecordedReply } from '../messages/entry-replies';
import {
  AMOUNT_NOT_POSITIVE_INTEGER_TEXT,
  AMOUNT_TOO_LARGE_TEXT,
  FORMAT_HELP_TEXT,
  ITEM_TOO_LONG_TEXT,
} from '../messages/texts';
import type { Replier } from '../reply-context';

/** webhook message 事件的 message 欄位（只取用到的部分）。 */
export interface IncomingMessage {
  type: string;
  text?: string | undefined;
}

type ParseErrorKind = Exclude<ParseResult['kind'], 'entry' | 'summary'>;

const PARSE_ERROR_TEXTS: Readonly<Record<ParseErrorKind, string>> = {
  formatError: FORMAT_HELP_TEXT,
  amountError: AMOUNT_NOT_POSITIVE_INTEGER_TEXT,
  amountTooLarge: AMOUNT_TOO_LARGE_TEXT,
  itemTooLong: ITEM_TOO_LONG_TEXT,
};

export class TextMessageHandler {
  constructor(
    private readonly transactions: Pick<TransactionService, 'createFromText'>,
    private readonly logger: Logger,
  ) {}

  async handle(message: IncomingMessage, replier: Replier): Promise<void> {
    if (message.type !== 'text' || message.text === undefined) {
      await replier.reply([textMessage(FORMAT_HELP_TEXT)]);
      return;
    }

    const parsed = parseTextEntry(message.text);
    switch (parsed.kind) {
      case 'summary':
        // P5（查詢月度文字摘要）接上；在此之前不回覆
        this.logger.info(
          { ledger: parsed.ledger, period: parsed.period },
          'summary not yet supported',
        );
        return;
      case 'entry':
        await replier.reply([await this.recordEntry(parsed)]);
        return;
      default:
        await replier.reply([textMessage(PARSE_ERROR_TEXTS[parsed.kind])]);
    }
  }

  private async recordEntry(entry: TextEntry): Promise<LineMessage> {
    const result = await this.transactions.createFromText(entry);
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
