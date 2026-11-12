/**
 * access 領域專用 step：W-follow（command）。
 * 文字必須與 specs/features/access/*.feature 逐字一致。
 *
 * 執行：npx cucumber-js specs/features/access    乾跑：npx cucumber-js specs/features/access --dry-run
 */
import { When } from '@cucumber/cucumber';
import { followEvent, postWebhook } from '../../support/line-event-factory';
import type { TestWorld } from '../../support/world';

// W-follow：送出已簽章的 follow 事件（POST /webhook/line，須回 HTTP 200）
When('{string} 加入好友', async function (this: TestWorld, userId: string) {
  await postWebhook(this, [followEvent(userId)]);
});
