/**
 * 分類業務邏輯（implementation-plan P6-3；specs/features/category/*.feature）。
 *
 *  - list：同帳本同收支，一般分類依 id 升冪，「其他」排最後。
 *  - create：名稱已由輸入層 trim；同帳本同收支同名（唯一約束 P2002，含併發）→ DUPLICATE_NAME。
 *  - delete：單一 DB 交易內依序
 *      鎖定分類列 → 不存在 NOT_FOUND / 「其他」FALLBACK_CATEGORY_UNDELETABLE
 *      → 找同帳本同收支的「其他」（找不到 = 資料損壞，拋一般 Error → rollback、500）
 *      → 紀錄、固定收支改歸「其他」→ 刪關鍵字 → 刪分類。
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import type { EntryType, Ledger } from '../domain/enums';
import { DomainError } from '../domain/errors';
import { isValidRecordId } from '../domain/record-id';
import {
  CategoryRepository,
  type CategoryDetail,
  type NewCategory,
} from '../repositories/category-repository';
import { KeywordRepository } from '../repositories/keyword-repository';
import { RecurringRepository } from '../repositories/recurring-repository';
import { TransactionRepository } from '../repositories/transaction-repository';

const NOT_FOUND_MESSAGE = '分類不存在';
const DUPLICATE_NAME_MESSAGE = '同帳本同收支已有同名分類';
const FALLBACK_UNDELETABLE_MESSAGE = '「其他」分類不可刪除';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export class CategoryService {
  constructor(private readonly prisma: PrismaClient) {}

  /** 查詢分類列表（「其他」排最後）。 */
  list(ledger: Ledger, entryType: EntryType): Promise<CategoryDetail[]> {
    return new CategoryRepository(this.prisma).listForDisplay(ledger, entryType);
  }

  /**
   * 新增一般分類。
   * @throws DomainError DUPLICATE_NAME
   */
  async create(input: NewCategory): Promise<CategoryDetail> {
    try {
      return await new CategoryRepository(this.prisma).create(input);
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError('DUPLICATE_NAME', DUPLICATE_NAME_MESSAGE);
      throw error;
    }
  }

  /**
   * 刪除分類；其紀錄改歸同帳本同收支的「其他」，其關鍵字一併刪除（單一交易）。
   * @throws DomainError NOT_FOUND、FALLBACK_CATEGORY_UNDELETABLE
   * @throws Error 找不到同組「其他」分類（資料損壞）
   */
  async delete(id: number): Promise<void> {
    if (!isValidRecordId(id)) throw new DomainError('NOT_FOUND', NOT_FOUND_MESSAGE);

    await this.prisma.$transaction(async (tx) => {
      const categories = new CategoryRepository(tx);
      const target = await categories.lockById(id);
      if (!target) throw new DomainError('NOT_FOUND', NOT_FOUND_MESSAGE);
      if (target.isFallback) {
        throw new DomainError('FALLBACK_CATEGORY_UNDELETABLE', FALLBACK_UNDELETABLE_MESSAGE);
      }

      const fallback = await categories.findFallback(target.ledger, target.entryType);
      if (!fallback) {
        throw new Error(
          `找不到 ${target.ledger}/${target.entryType} 的「其他」分類，無法刪除分類 ${target.id}`,
        );
      }

      await new TransactionRepository(tx).reassignCategory(target.id, fallback.id);
      await new RecurringRepository(tx).reassignCategory(target.id, fallback.id);
      await new KeywordRepository(tx).deleteByCategoryId(target.id);
      await categories.deleteById(target.id);
    });
  }
}
