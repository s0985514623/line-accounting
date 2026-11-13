/**
 * 每月固定收支排程：每次 tick
 *  1. 產生所有到期（≤ Asia/Taipei 今天）的各期（RecurringService.generateDue，冪等）。
 *  2. Asia/Taipei RECURRING_NOTIFY_HOUR 點以後，把尚未推播的待確認各期推播給擁有者
 *     （一次最多 MAX_PUSH_MESSAGES 則）；推播成功才標記已通知，失敗則下次 tick 重試。
 * 單一程序內以 running 旗標避免 tick 重疊；錯誤只記錄，不中斷排程。
 */
import type { Logger } from 'pino';
import { todayInTaipei } from '../domain/date-utils';
import { hourInTaipei, RECURRING_NOTIFY_HOUR } from '../domain/recurring-schedule';
import { buildOccurrenceNotice } from '../line/messages/recurring-replies';
import type { Clock } from '../ports/clock';
import { MAX_PUSH_MESSAGES, type LinePushGateway } from '../ports/line-reply-gateway';
import type { RecurringService } from '../services/recurring-service';

/** 預設每 15 分鐘檢查一次。 */
export const DEFAULT_RECURRING_TICK_MS = 15 * 60 * 1000;

export interface RecurringSchedulerDeps {
  recurring: Pick<RecurringService, 'generateDue' | 'listUnnotifiedOccurrences' | 'markNotified'>;
  gateway: LinePushGateway;
  clock: Clock;
  ownerUserId: string;
  liffId: string;
  logger: Logger;
}

export class RecurringScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: RecurringSchedulerDeps) {}

  /** 立即執行一次，之後每 intervalMs 執行。 */
  start(intervalMs: number = DEFAULT_RECURRING_TICK_MS): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.deps.clock.now();
      const advanced = await this.deps.recurring.generateDue(todayInTaipei(now));
      if (advanced > 0) this.deps.logger.info({ advanced }, 'recurring occurrences generated');
      if (hourInTaipei(now) >= RECURRING_NOTIFY_HOUR) await this.notify();
    } catch (error) {
      this.deps.logger.error({ err: error }, 'recurring scheduler tick failed');
    } finally {
      this.running = false;
    }
  }

  private async notify(): Promise<void> {
    const occurrences = await this.deps.recurring.listUnnotifiedOccurrences();
    for (let start = 0; start < occurrences.length; start += MAX_PUSH_MESSAGES) {
      const chunk = occurrences.slice(start, start + MAX_PUSH_MESSAGES);
      const sent = await this.deps.gateway.push(
        this.deps.ownerUserId,
        chunk.map((occurrence) => buildOccurrenceNotice(occurrence, this.deps.liffId)),
      );
      if (!sent) return; // 下次 tick 重試
      await this.deps.recurring.markNotified(chunk.map((occurrence) => occurrence.id));
      this.deps.logger.info({ count: chunk.length }, 'recurring occurrences notified');
    }
  }
}
