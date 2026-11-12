/**
 * 分類資料存取（Repository）。以 PrismaClient 或交易內的 TransactionClient 建立，
 * 由 service 決定交易邊界。
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { DefaultCategory } from '../domain/default-categories';
import type { EntryType, Ledger } from '../domain/enums';

export type DbClient = PrismaClient | Prisma.TransactionClient;

/** 比對 / 選單用的分類摘要。 */
export interface CategorySummary {
  id: number;
  name: string;
  isFallback: boolean;
}

/** 含帳本與收支的分類資料。 */
export interface CategoryDetail extends CategorySummary {
  ledger: Ledger;
  entryType: EntryType;
}

const SUMMARY_SELECT = { id: true, name: true, isFallback: true } as const;

export class CategoryRepository {
  constructor(private readonly db: DbClient) {}

  /** 全部分類數量（不分帳本、收支）。 */
  count(): Promise<number> {
    return this.db.category.count();
  }

  /**
   * 依傳入順序批次建立分類；與既有唯一約束衝突者略過（併發 follow 時不報錯）。
   * @returns 實際建立筆數
   */
  async createMany(categories: readonly DefaultCategory[]): Promise<number> {
    const result = await this.db.category.createMany({
      data: categories.map(({ ledger, entryType, name, isFallback }) => ({
        ledger,
        entryType,
        name,
        isFallback,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  /** 同帳本同收支、名稱完全相等的分類（唯一約束 ledger × entryType × name）。 */
  findByName(ledger: Ledger, entryType: EntryType, name: string): Promise<CategorySummary | null> {
    return this.db.category.findUnique({
      where: { ledger_entryType_name: { ledger, entryType, name } },
      select: SUMMARY_SELECT,
    });
  }

  /** 依 id 取分類（含帳本、收支，供驗證歸屬）；不存在回 null。 */
  findById(id: number): Promise<CategoryDetail | null> {
    return this.db.category.findUnique({
      where: { id },
      select: { ...SUMMARY_SELECT, ledger: true, entryType: true },
    });
  }

  /** 同帳本同收支的全部分類，依 id 升冪。 */
  listByGroup(ledger: Ledger, entryType: EntryType): Promise<CategorySummary[]> {
    return this.db.category.findMany({
      where: { ledger, entryType },
      orderBy: { id: 'asc' },
      select: SUMMARY_SELECT,
    });
  }

  /** 依 id 批次取分類名稱（id → name）；不存在的 id 不在結果中。 */
  async findNamesByIds(ids: readonly number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.category.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
