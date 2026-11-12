/**
 * 已使用的分類按鈕 token 資料存取（Repository）。token 為 PK：同一 token 只能寫入一次，
 * 併發重複寫入時由資料庫拋 Prisma P2002（由 service 轉譯）。
 */
import type { DbClient } from './category-repository';

export class PostbackTokenRepository {
  constructor(private readonly db: DbClient) {}

  /** token 是否已使用過。 */
  async isUsed(token: string): Promise<boolean> {
    const row = await this.db.postbackToken.findUnique({
      where: { token },
      select: { token: true },
    });
    return row !== null;
  }

  /** 標記 token 為已使用（尚未對應記帳紀錄）。重複 token 時拋 Prisma P2002。 */
  async markUsed(token: string): Promise<void> {
    await this.db.postbackToken.create({ data: { token }, select: { token: true } });
  }

  /** 回填 token 對應的記帳紀錄 id。 */
  async attachTransaction(token: string, transactionId: number): Promise<void> {
    await this.db.postbackToken.update({
      where: { token },
      data: { transactionId },
      select: { token: true },
    });
  }
}
