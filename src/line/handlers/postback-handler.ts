/**
 * 白名單使用者的 postback 事件。
 *
 *  - data 以 decodePostback 解碼；解碼失敗（竄改、缺欄位、欄位不合法）→ 回「資料格式錯誤，請重新記帳」（ASM-07）。
 *  - pick（分類按鈕）→ completePick：
 *      recorded → 已記帳摘要 + 刪除按鈕；alreadyUsed → 此筆已記帳；
 *      categoryNotFound → 分類不存在，請重新記帳；categoryMismatch → 分類不符，請重新記帳。
 *    非預期例外不在此吞掉，交由 event-dispatcher 回「系統忙碌」。
 *  - bpick（批次待分類項目的分類按鈕）→ completeBatchPick：
 *      recorded → [已記帳摘要 + 刪除按鈕, (同批次自動記帳清單), 下一筆分類 Quick Reply 或「全部完成」]；
 *      alreadyUsed / categoryNotFound / categoryMismatch → 同 pick 的文字。
 *  - delete（刪除按鈕）→ findSummaryById：存在 → 「確定刪除？…」confirm template；不存在 → 此紀錄已不存在。
 *  - delete_confirm（確定）→ deleteById：deleted → 已刪除：…；notFound → 此紀錄已不存在。
 *  - delete_cancel（取消）→ findSummaryById：存在 → 已取消刪除；不存在 → 此紀錄已不存在。絕不刪除。
 * 依據：specs/features/transaction/選擇分類完成記帳.feature、請求刪除記帳紀錄.feature、確認刪除記帳紀錄.feature；
 *       implementation-plan P3-6、P4、DF-2。
 */
import type { Logger } from 'pino';
import {
  decodePostback,
  type PickPayload,
  type PostbackPayload,
} from '../../domain/postback-codec';
import type { LineMessage } from '../../ports/line-reply-gateway';
import type {
  CompleteBatchPickResult,
  CompletePickResult,
  TransactionService,
} from '../../services/transaction-service';
import { buildAutoRecordedText, buildPendingPrompt } from '../messages/batch-replies';
import { textMessage } from '../messages/builders';
import { buildDeleteConfirmReply, buildDeletedReply } from '../messages/delete-replies';
import { buildRecordedReply } from '../messages/entry-replies';
import {
  BATCH_ALL_DONE_TEXT,
  DELETE_CANCELLED_TEXT,
  PICK_ALREADY_USED_TEXT,
  PICK_CATEGORY_MISMATCH_TEXT,
  PICK_CATEGORY_NOT_FOUND_TEXT,
  POSTBACK_DATA_INVALID_TEXT,
  RECORD_NOT_FOUND_TEXT,
} from '../messages/texts';
import type { Replier } from '../reply-context';

/** webhook postback 事件的 postback 欄位（只取用到的部分）。 */
export interface IncomingPostback {
  data: string;
}

type PickFailureKind = Exclude<
  CompletePickResult['kind'] | CompleteBatchPickResult['kind'],
  'recorded'
>;

const PICK_FAILURE_TEXTS: Readonly<Record<PickFailureKind, string>> = {
  alreadyUsed: PICK_ALREADY_USED_TEXT,
  categoryNotFound: PICK_CATEGORY_NOT_FOUND_TEXT,
  categoryMismatch: PICK_CATEGORY_MISMATCH_TEXT,
};

export class PostbackHandler {
  constructor(
    private readonly transactions: Pick<
      TransactionService,
      'completePick' | 'completeBatchPick' | 'findSummaryById' | 'deleteById'
    >,
    private readonly logger: Logger,
  ) {}

  async handle(postback: IncomingPostback, replier: Replier): Promise<void> {
    const payload = decodePostback(postback.data);
    if (payload === null) {
      this.logger.warn('postback data invalid; rejected');
      await replier.reply([textMessage(POSTBACK_DATA_INVALID_TEXT)]);
      return;
    }

    // 先取得回覆內容再回覆：service 例外往外拋時不會先用掉一次性的 reply token
    const messages = await this.resolveReply(payload);
    await replier.reply(messages);
  }

  private async resolveReply(payload: PostbackPayload): Promise<LineMessage[]> {
    switch (payload.action) {
      case 'pick': {
        const { action: _action, ...pick } = payload;
        return [await this.completePick(pick)];
      }
      case 'bpick':
        return this.completeBatchPick(payload.pendingId, payload.categoryId);
      case 'delete':
        return [await this.requestDelete(payload.id)];
      case 'delete_confirm':
        return [await this.confirmDelete(payload.id)];
      case 'delete_cancel':
        return [await this.cancelDelete(payload.id)];
    }
  }

  private async completeBatchPick(pendingId: number, categoryId: number): Promise<LineMessage[]> {
    const result = await this.transactions.completeBatchPick(pendingId, categoryId);
    if (result.kind !== 'recorded') return [textMessage(PICK_FAILURE_TEXTS[result.kind])];

    const messages: LineMessage[] = [buildRecordedReply(result.picked)];
    if (result.autoRecorded.length > 0) messages.push(buildAutoRecordedText(result.autoRecorded));
    messages.push(result.next ? buildPendingPrompt(result.next) : textMessage(BATCH_ALL_DONE_TEXT));
    return messages;
  }

  private async requestDelete(id: number): Promise<LineMessage> {
    const summary = await this.transactions.findSummaryById(id);
    if (!summary) return textMessage(RECORD_NOT_FOUND_TEXT);
    return buildDeleteConfirmReply({
      transactionId: summary.id,
      item: summary.item,
      amount: summary.amount,
      occurredOn: summary.occurredOn,
    });
  }

  private async confirmDelete(id: number): Promise<LineMessage> {
    const result = await this.transactions.deleteById(id);
    if (result.kind === 'notFound') return textMessage(RECORD_NOT_FOUND_TEXT);
    this.logger.info({ transactionId: id }, 'transaction deleted');
    return buildDeletedReply({
      item: result.item,
      amount: result.amount,
      occurredOn: result.occurredOn,
    });
  }

  private async cancelDelete(id: number): Promise<LineMessage> {
    const summary = await this.transactions.findSummaryById(id);
    return textMessage(summary ? DELETE_CANCELLED_TEXT : RECORD_NOT_FOUND_TEXT);
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
