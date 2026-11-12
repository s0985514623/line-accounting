import { PrismaClient } from '@prisma/client';

let instance: PrismaClient | null = null;

/**
 * 取得行程內唯一的 PrismaClient（server / CLI 使用；測試自行建立並經 createApp 注入）。
 * 第一次呼叫時以 databaseUrl 建立，之後回傳同一實例。
 */
export function getPrismaClient(databaseUrl: string): PrismaClient {
  instance ??= new PrismaClient({ datasourceUrl: databaseUrl });
  return instance;
}

/** 關閉並清除單例（graceful shutdown 使用）。 */
export async function disconnectPrismaClient(): Promise<void> {
  if (!instance) return;
  const client = instance;
  instance = null;
  await client.$disconnect();
}
