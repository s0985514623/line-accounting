/**
 * GET /healthz：容器內部健康檢查（不需認證）。以 `SELECT 1` 檢查 DB；成功 200，失敗 503。
 * 回應只含狀態字串，不帶任何錯誤細節（避免洩漏連線資訊）。
 */
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';

export function createHealthRouter(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  logger: Logger,
): Router {
  const router = Router();

  router.get('/healthz', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ status: 'ok' });
    } catch (error) {
      // 只記錄錯誤名稱與代碼，不記錄訊息（Prisma 連線錯誤訊息含主機資訊）
      const { name, code } = (error ?? {}) as { name?: string; code?: string };
      logger.warn({ errorName: name, errorCode: code }, 'healthz: database unavailable');
      res.status(503).json({ status: 'unavailable' });
    }
  });

  return router;
}
