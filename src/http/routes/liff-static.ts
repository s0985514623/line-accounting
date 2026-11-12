/**
 * LIFF 前端靜態檔（P8.3；implementation-plan P8 步驟 5、deployment-runbook §2）。
 *
 *  GET /liff/config.json  → { liffId }，取自執行期設定（同一映像可用於不同環境），no-store
 *  GET /liff/assets/*     → Vite 產物（檔名含 hash）→ immutable、max-age 1 年；不存在 → 404，不 fallback
 *  GET /liff、/liff/**    → SPA fallback：index.html，no-cache（新版部署後立即生效）
 *  其他方法               → 不處理（落到 Express 預設 404）
 *
 * 路徑穿越：assets 由 serve-static（send）處理，含 `..` 的請求被拒後落到 404；
 * SPA fallback 只會送出固定的 index.html，不使用請求路徑組檔名。
 */
import path from 'node:path';
import express, { Router, type RequestHandler } from 'express';

export const LIFF_PREFIX = '/liff';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const INDEX_FILE = 'index.html';
const NO_STORE = 'no-store';
const NO_CACHE = 'no-cache';

export interface LiffStaticOptions {
  /** 前端 build 產物目錄（內含 index.html 與 assets/*） */
  webDistDir: string;
  /** 執行期 LIFF_ID */
  liffId: string;
}

/** 404 一律 no-store，避免瀏覽器 / CDN 快取壞掉的回應。 */
const notFound: RequestHandler = (_req, res) => {
  res.setHeader('Cache-Control', NO_STORE);
  res.status(404).type('text/plain').send('Not Found');
};

export function createLiffStaticRouter(options: LiffStaticOptions): Router {
  const distDir = path.resolve(options.webDistDir);
  const configBody = Object.freeze({ liffId: options.liffId });
  const router = Router();

  router.get(`${LIFF_PREFIX}/config.json`, (_req, res) => {
    res.setHeader('Cache-Control', NO_STORE);
    res.status(200).json(configBody);
  });

  router.use(
    `${LIFF_PREFIX}/assets`,
    express.static(path.join(distDir, 'assets'), {
      immutable: true,
      maxAge: ONE_YEAR_MS,
      index: false,
      redirect: false,
      dotfiles: 'ignore',
      fallthrough: true,
    }),
    notFound,
  );

  const sendIndex: RequestHandler = (req, res, next) => {
    res.setHeader('Cache-Control', NO_CACHE);
    res.sendFile(INDEX_FILE, { root: distDir, cacheControl: false, dotfiles: 'deny' }, (error) => {
      if (!error) return;
      if (res.headersSent) {
        next(error);
        return;
      }
      // 前端尚未建置（index.html 不存在）→ 404，不當成 500
      notFound(req, res, next);
    });
  };

  router.get([LIFF_PREFIX, `${LIFF_PREFIX}/*`], sendIndex);

  return router;
}
