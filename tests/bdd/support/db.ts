/**
 * 測試資料庫工具（BDD、HTTP、DB 測試共用；不依賴 cucumber）。
 *
 * DB 來源：
 *   1. 環境變數 TEST_DATABASE_URL（CI service container / 本機 docker-compose.dev.yml）
 *      例：postgresql://test:test@localhost:5433/test
 *   2. 未提供時才啟動 Testcontainers（postgres:16）
 *
 * 本檔一律以「原生 SQL + 資料表名稱（erm.dbml）」讀寫資料，
 * 不依賴 Prisma model 命名，避免測試與實作細節耦合。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

export interface TestDatabase {
  /** 可直接作為 DATABASE_URL 的連線字串 */
  url: string;
  stop(): Promise<void>;
}

/** 取得測試 DB：優先使用 TEST_DATABASE_URL，否則啟動 Testcontainers。 */
export async function acquireTestDatabase(): Promise<TestDatabase> {
  const provided = process.env.TEST_DATABASE_URL;
  if (provided && provided.trim() !== '') {
    return { url: provided.trim(), stop: async () => {} };
  }
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const container = await new PostgreSqlContainer('postgres:16')
    .withDatabase('test')
    .withUsername('test')
    .withPassword('test')
    .start();
  return {
    url: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}

/** 在連線字串上指定 PostgreSQL schema（供需要隔離的測試使用）。 */
export function withSchema(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  return url.toString();
}

/** 以子程序執行 `prisma migrate deploy`（帶 DATABASE_URL）；失敗時拋出含輸出的錯誤。 */
export function runMigrateDeploy(databaseUrl: string): void {
  const prismaCli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `prisma migrate deploy 失敗（exit ${result.status}）\n${result.stdout}\n${result.stderr}`,
    );
  }
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: databaseUrl });
}

// ---- 跨 hooks / world 共用的單一 PrismaClient ---------------------------------------------

let sharedPrisma: PrismaClient | null = null;

export function setSharedPrisma(client: PrismaClient | null): void {
  sharedPrisma = client;
}

export function getSharedPrisma(): PrismaClient {
  if (!sharedPrisma) {
    throw new Error('共用 PrismaClient 尚未建立（BeforeAll 未執行？）');
  }
  return sharedPrisma;
}

// ---- 資料表操作 ----------------------------------------------------------------------------

export const ALL_TABLES = [
  'categories',
  'category_keywords',
  'transactions',
  'postback_tokens',
  'pending_entries',
  'recurring_entries',
  'recurring_occurrences',
];

export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE ${ALL_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

export type SqlValue = string | number | boolean | null;

/** 將值轉為 SQL 字面量（測試資料專用；字串以單引號跳脫，不使用參數以避免 enum 型別轉換問題）。 */
export function sqlLiteral(value: SqlValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`非有限數值：${value}`);
    return String(value);
  }
  if (value.includes('\u0000')) throw new Error('字串不可含 NUL 字元');
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * 各表的時間戳欄位。測試資料未指定時一律補 NOW()，
 * 讓 Given 不依賴 DB 預設值是否存在（Prisma 的 @updatedAt 不會產生 DB DEFAULT）。
 */
const TIMESTAMP_COLUMNS: Record<string, string[]> = {
  categories: ['created_at'],
  category_keywords: ['created_at'],
  transactions: ['created_at', 'updated_at'],
  postback_tokens: ['used_at'],
};

/** 逐筆寫入資料（欄位名稱即資料表欄位，值經 sqlLiteral 轉義；時間戳欄位自動補 NOW()）。 */
export async function insertRows(
  prisma: PrismaClient,
  table: string,
  rows: Array<Record<string, SqlValue>>,
): Promise<void> {
  const timestamps = TIMESTAMP_COLUMNS[table] ?? [];
  for (const row of rows) {
    const columns = Object.keys(row);
    const values = columns.map((c) => sqlLiteral(row[c] as SqlValue));
    for (const column of timestamps) {
      if (!columns.includes(column)) {
        columns.push(column);
        values.push('NOW()');
      }
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')})`,
    );
  }
}

/**
 * 寫入資料；若 rows 指定了 id，寫入後把序列推進到 MAX(id)，
 * 避免後續由應用程式 INSERT 時發生 PK 衝突（implementation-plan R13）。
 */
export async function insertWithIds(
  prisma: PrismaClient,
  table: string,
  rows: Array<Record<string, SqlValue>>,
): Promise<void> {
  await insertRows(prisma, table, rows);
  if (rows.some((r) => 'id' in r)) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT MAX(id) FROM ${table}), 1))`,
    );
  }
}

/** 執行原生 SELECT 並指定列型別（避免依賴 Prisma 產生的型別）。 */
export async function queryRows<T>(prisma: PrismaClient, sql: string): Promise<T[]> {
  const rows: unknown = await prisma.$queryRawUnsafe(sql);
  return rows as T[];
}

/** 以 (帳本, 收支, 名稱) 查分類 id（找不到時拋出明確錯誤，方便定位 Given 資料問題）。 */
export async function findCategoryId(
  prisma: PrismaClient,
  ledger: string,
  entryType: string,
  name: string,
): Promise<number> {
  const rows = await queryRows<{ id: number }>(
    prisma,
    `SELECT id FROM categories WHERE ledger = ${sqlLiteral(ledger)} ` +
      `AND entry_type = ${sqlLiteral(entryType)} AND name = ${sqlLiteral(name)}`,
  );
  const first = rows[0];
  if (!first) {
    throw new Error(
      `找不到分類：帳本=${ledger} 收支=${entryType} 名稱=${name}（請先以 Given 建立分類）`,
    );
  }
  return first.id;
}
