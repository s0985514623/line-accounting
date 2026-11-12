/**
 * LIFF 封裝：整個前端唯一直接依賴 @line/liff SDK 的模組。
 * 模組本身無狀態（不快取 init 結果）；bootstrap 只會呼叫 initLiff 一次。
 */
import liff from '@line/liff';
import { z } from 'zod';

export type TLiffInitResult = 'ready' | 'redirecting';

const CONFIG_PATH = '/liff/config.json';

const liffConfigSchema = z.object({
  liffId: z.string().min(1),
});

/**
 * 是否啟用 @line/liff-mock（ASM-13）。
 * 只在 Vite 開發模式且明確設定 VITE_LIFF_MOCK=true 時啟用；
 * production build 中 import.meta.env.DEV 為常數 false，整段（含動態 import）會被移除。
 */
const shouldUseLiffMock = (): boolean =>
  import.meta.env.DEV && import.meta.env.VITE_LIFF_MOCK === 'true';

/** 取得後端提供的 LIFF 設定；任何失敗（網路、非 2xx、缺 liffId）都拋出 Error。 */
async function fetchLiffId(): Promise<string> {
  let response: Response;
  try {
    response = await fetch(new URL(CONFIG_PATH, window.location.origin));
  } catch (cause) {
    throw new Error('無法取得 LIFF 設定（網路錯誤）', { cause });
  }
  if (!response.ok) {
    throw new Error(`無法取得 LIFF 設定（HTTP ${response.status}）`);
  }
  const parsed = liffConfigSchema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    throw new Error('LIFF 設定缺少 liffId');
  }
  return parsed.data.liffId;
}

/**
 * 初始化 LIFF：fetch /liff/config.json → liff.init → 檢查登入。
 * @returns 'ready' 可 render 應用程式；'redirecting' 已呼叫 liff.login，頁面即將導向 LINE Login
 */
export async function initLiff(): Promise<TLiffInitResult> {
  const liffId = await fetchLiffId();

  if (shouldUseLiffMock()) {
    const { LiffMockPlugin } = await import('@line/liff-mock');
    liff.use(new LiffMockPlugin());
    const mockConfig = { liffId, mock: true };
    await liff.init(mockConfig);
  } else {
    await liff.init({ liffId });
  }

  if (!liff.isLoggedIn()) {
    liff.login();
    return 'redirecting';
  }
  return 'ready';
}

/** 取得目前的 LIFF ID token；尚未取得時回傳 null。 */
export function getIdToken(): string | null {
  return liff.getIDToken() ?? null;
}

/** 重新登入（在 LINE App 外會導向 LINE Login）。 */
export function login(): void {
  liff.login();
}
