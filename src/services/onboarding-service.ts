/**
 * 首次使用的初始化（follow 事件與 CLI seed-defaults 共用）。
 */
import type { PrismaClient } from '@prisma/client';
import { DEFAULT_CATEGORIES } from '../domain/default-categories';
import { CategoryRepository } from '../repositories/category-repository';

export interface EnsureDefaultCategoriesResult {
  /** 本次建立的分類數；已有任何分類時為 0。 */
  created: number;
}

export class OnboardingService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * 系統中沒有任何分類時，建立 19 個預設分類；已有任何分類（例如封鎖後解除封鎖）則不動。冪等。
   * 單一 DB 交易內執行 count → createMany(skipDuplicates)，併發呼叫也不會重複或違反唯一約束。
   */
  async ensureDefaultCategories(): Promise<EnsureDefaultCategoriesResult> {
    return this.prisma.$transaction(async (tx) => {
      const categories = new CategoryRepository(tx);
      if ((await categories.count()) > 0) return { created: 0 };
      return { created: await categories.createMany(DEFAULT_CATEGORIES) };
    });
  }
}
