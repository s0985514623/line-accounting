/**
 * 白名單使用者的 postback 事件。
 *
 *  - data 以 decodePostback 解碼；解碼失敗（竄改、缺欄位、欄位不合法）→ 回「資料格式錯誤，請重新記帳」（ASM-07）。
 *  - pick（分類按鈕）→ completePick：
 *      recorded → 已記帳摘要 + 刪除按鈕；alreadyUsed → 此筆已記帳；
 *      categoryNotFound → 分類不存在，請重新記帳；categoryMismatch → 分類不符，請重新記帳。
 *    非預期例外不在此吞掉，交由 event-dispatcher 回「系統忙碌」。
 *  - delete（刪除按鈕）由 P4 實作；目前只記 log、不回覆。
 * 依據：specs/features/transaction/選擇分類完成記帳.feature；implementation-plan P3-6、DF-2。
 */
import type { Logger } from 'pino';
import { decodePostback, type PickPayload } from '../../domain/postback-codec';
import type { LineMessage } from '../../ports/line-reply-gateway';
import type { CompletePickResult, TransactionService } from '../../services/transaction-service';
import { textMessage } from '../messages/builders';
import { buildRecordedReply } from '../messages/entry-replies';
import {
  PICK_ALREADY_USED_TEXT,
  PICK_CATEGORY_MISMATCH_TEXT,
  PICK_CATEGORY_NOT_FOUND_TEXT,
  POSTBACK_DATA_INVALID_TEXT,
} from '../messages/texts';
import type { Replier } from '../reply-context';

/** webhook postback 事件的 postback 欄位（只取用到的部分）。 */
export interface IncomingPostback {
  data: string;
}

type PickFailureKind = Exclude<CompletePickResult['kind'], 'recorded'>;

const PICK_FAILURE_TEXTS: Readonly<Record<PickFailureKind, string>> = {
  alreadyUsed: PICK_ALREADY_USED_TEXT,
  categoryNotFound: PICK_CATEGORY_NOT_FOUND_TEXT,
  categoryMismatch: PICK_CATEGORY_MISMATCH_TEXT,
};

export class PostbackHandler {
  constructor(
    private readonly transactions: Pick<TransactionService, 'completePick'>,
    private readonly logger: Logger,
  ) {}

  async handle(postback: IncomingPostback, replier: Replier): Promise<void> {
    const payload = decodePostback(postback.data);
    if (payload === null) {
      this.logger.warn('postback data invalid; rejected');
      await replier.reply([textMessage(POSTBACK_DATA_INVALID_TEXT)]);
      return;
    }

    switch (payload.action) {
      case 'pick': {
        const { action: _action, ...pick } = payload;
        await replier.reply([await this.completePick(pick)]);
        return;
      }
      case 'delete':
        // P4（請求刪除記帳紀錄）接上；在此之前不回覆
        this.logger.info({ transactionId: payload.id }, 'delete postback not yet supported');
        return;
    }
  }

  private async completePick(pick: PickPayload): Promise<LineMessage> {
    const result = await this.transactions.completePick(pick);
    if (result.kind !== 'recorded') {
      return textMessage(PICK_FAILURE_TEXTS[result.kind]);
    }
    return buildRecordedReply({
      ledger: pick.ledger,
      entryType: pick.entryType,
      item: pick.item,
      amount: pick.amount,
      categoryName: result.categoryName,
      occurredOn: result.occurredOn,
      transactionId: result.transactionId,
    });
  }
}
