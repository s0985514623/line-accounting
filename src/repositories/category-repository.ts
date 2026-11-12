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
const DETAIL_SELECT = { ...SUMMARY_SELECT, ledger: true, entryType: true } as const;

/** 新增一般分類的輸入。 */
export interface NewCategory {
  ledger: Ledger;
  entryType: EntryType;
  name: string;
}

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
      select: DETAIL_SELECT,
    });
  }

  /**
   * 交易內以 `SELECT … FOR UPDATE` 鎖定分類列並回傳其資料；不存在回 null。
   * 鎖住後，併發的「以此分類新增紀錄」（FK 需要 KEY SHARE 鎖）會等到本交易結束，
   * 避免改歸「其他」之後又有新紀錄指向即將刪除的分類。
   */
  async lockById(id: number): Promise<CategoryDetail | null> {
    const rows = await this.db.$queryRaw<
      Array<{
        id: number;
        name: string;
        is_fallback: boolean;
        ledger: Ledger;
        entry_type: EntryType;
      }>
    >`SELECT id, name, is_fallback, ledger::text AS ledger, entry_type::text AS entry_type
      FROM categories WHERE id = ${id} FOR UPDATE`;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      isFallback: row.is_fallback,
      ledger: row.ledger,
      entryType: row.entry_type,
    };
  }

  /** 同帳本同收支的「其他」分類；不存在（資料損壞）回 null。 */
  findFallback(ledger: Ledger, entryType: EntryType): Promise<CategorySummary | null> {
    return this.db.category.findFirst({
      where: { ledger, entryType, isFallback: true },
      select: SUMMARY_SELECT,
    });
  }

  /** LIFF 顯示用：同帳本同收支的分類，一般分類依 id 升冪，「其他」排最後。 */
  listForDisplay(ledger: Ledger, entryType: EntryType): Promise<CategoryDetail[]> {
    return this.db.category.findMany({
      where: { ledger, entryType },
      orderBy: [{ isFallback: 'asc' }, { id: 'asc' }],
      select: DETAIL_SELECT,
    });
  }

  /** 建立一般分類（isFallback = false）。同名時拋 Prisma P2002。 */
  create(input: NewCategory): Promise<CategoryDetail> {
    return this.db.category.create({
      data: { ledger: input.ledger, entryType: input.entryType, name: input.name },
      select: DETAIL_SELECT,
    });
  }

  /** 刪除分類（關鍵字由 FK cascade 一併刪除；仍有紀錄指向時由 DB 拋出 FK 錯誤）。 */
  async deleteById(id: number): Promise<void> {
    await this.db.category.delete({ where: { id }, select: { id: true } });
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
