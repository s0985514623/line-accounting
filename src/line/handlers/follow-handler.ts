/**
 * follow 事件（白名單使用者加好友 / 解除封鎖）：確保預設分類存在，回覆歡迎訊息。
 * 依據：specs/features/access/加入好友.feature。
 */
import { textMessage } from '../messages/builders';
import { WELCOME_TEXT } from '../messages/texts';
import type { Replier } from '../reply-context';
import type { EnsureDefaultCategoriesResult } from '../../services/onboarding-service';

export interface DefaultCategoriesInitializer {
  ensureDefaultCategories(): Promise<EnsureDefaultCategoriesResult>;
}

export class FollowHandler {
  constructor(private readonly onboarding: DefaultCategoriesInitializer) {}

  async handle(replier: Replier): Promise<void> {
    await this.onboarding.ensureDefaultCategories();
    await replier.reply([textMessage(WELCOME_TEXT)]);
  }
}
