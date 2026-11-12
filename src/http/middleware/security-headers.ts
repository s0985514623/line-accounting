/**
 * 全站安全標頭（helmet）。CSP 只放行 LIFF 需要的 LINE 網域（implementation-plan P8 步驟 5）：
 *  - script-src：自身 bundle + LINE CDN；不允許 unsafe-eval / unsafe-inline（Vite 產物無 inline script）
 *  - connect-src：自身 /api、LIFF SDK 呼叫的 api.line.me / access.line.me / liff.line.me / LINE CDN
 *  - img-src：自身、data: URI 與 LINE 頭像（*.line-scdn.net）
 *  - style-src：允許 'unsafe-inline'（僅樣式；Recharts 以 style 屬性定位 SVG / tooltip）
 */
import helmet from 'helmet';
import type { RequestHandler } from 'express';

const SELF = "'self'";
const LINE_CDN = 'https://*.line-scdn.net';

export const CSP_DIRECTIVES = {
  defaultSrc: [SELF],
  baseUri: [SELF],
  objectSrc: ["'none'"],
  frameAncestors: [SELF],
  formAction: [SELF],
  scriptSrc: [SELF, LINE_CDN],
  scriptSrcAttr: ["'none'"],
  styleSrc: [SELF, "'unsafe-inline'"],
  imgSrc: [SELF, 'data:', LINE_CDN],
  fontSrc: [SELF, 'data:'],
  connectSrc: [
    SELF,
    'https://api.line.me',
    'https://access.line.me',
    'https://liff.line.me',
    LINE_CDN,
  ],
  upgradeInsecureRequests: [],
} as const satisfies Record<string, readonly string[]>;

export function createSecurityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: Object.fromEntries(
        Object.entries(CSP_DIRECTIVES).map(([name, sources]) => [name, [...sources]]),
      ),
    },
  });
}
