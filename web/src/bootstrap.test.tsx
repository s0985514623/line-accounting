/**
 * 啟動流程（R9）：liff.init() 完成前不得 render router。
 *
 * 執行：npm --prefix web test -- src/bootstrap.test.tsx
 * 假設的模組介面（web/src/bootstrap.tsx；main.tsx 只做 bootstrap(document.getElementById('root')!)）：
 *   bootstrap(container: HTMLElement): Promise<{ unmount(): void }>
 *     - 立即 render 載入中畫面：<div role="status">載入中…</div>
 *     - await initLiff()：
 *         'ready'        → 才 render <App />（QueryClientProvider + BrowserRouter basename="/liff"）
 *         'redirecting'  → 維持載入中畫面（頁面即將被導向 LINE Login）
 *         拋錯           → render <div role="alert">LIFF 初始化失敗…</div>，不 render router
 *     - 回傳的 Promise 在上述任一分支 render 完成後 resolve
 */
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrap } from './bootstrap';
import { requestLog } from './test/mocks/handlers';
import { liffMock } from './test/mocks/liff';

let container: HTMLElement;
let handle: { unmount(): void } | undefined;

beforeEach(() => {
  container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);
  window.history.replaceState({}, '', '/liff/');
});

afterEach(() => {
  act(() => handle?.unmount());
  handle = undefined;
  container.remove();
  window.history.replaceState({}, '', '/liff/');
});

/** 在 act 內啟動，確保「載入中」畫面已 flush；回傳 bootstrap 的 Promise（尚未 await）。 */
async function start() {
  let pending!: Promise<{ unmount(): void }>;
  await act(async () => {
    pending = bootstrap(container);
  });
  return pending;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('bootstrap / R9', () => {
  describe('Smoke', () => {
    it('init 成功且已登入後 render 列表頁（首頁 /liff/）', async () => {
      handle = await start();

      expect(await screen.findByRole('heading', { name: '記帳紀錄' })).toBeInTheDocument();
    });
  });

  describe('R9：liff.init 完成前不 render router', () => {
    it('init 尚未 resolve 時只顯示載入中，且不發出任何 /api 請求', async () => {
      const gate = deferred();
      liffMock.init.mockReturnValue(gate.promise);

      const pending = start();

      expect(await screen.findByRole('status')).toHaveTextContent('載入中');
      expect(screen.queryByRole('heading', { name: '記帳紀錄' })).not.toBeInTheDocument();
      expect(requestLog.filter((r) => r.pathname.startsWith('/api/'))).toHaveLength(0);

      gate.resolve();
      handle = await pending;

      expect(await screen.findByRole('heading', { name: '記帳紀錄' })).toBeInTheDocument();
    });

    it('深層連結：liff.init 期間 SDK 才把 liff.state 還原成真實路徑，router 必須讀到還原後的路徑', async () => {
      // LIFF secondary redirect：實際網址一開始是 /liff/?liff.state=%2Fnew，liff.init() 內部才 replaceState 成 /liff/new
      window.history.replaceState({}, '', '/liff/?liff.state=%2Fnew');
      liffMock.init.mockImplementation(async () => {
        window.history.replaceState({}, '', '/liff/new');
      });

      handle = await start();

      expect(await screen.findByRole('heading', { name: '新增記帳' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: '記帳紀錄' })).not.toBeInTheDocument();
    });

    it('未登入：呼叫 liff.login，維持載入中，永遠不 render router', async () => {
      liffMock.isLoggedIn.mockReturnValue(false);

      handle = await start();

      expect(liffMock.login).toHaveBeenCalledTimes(1);
      expect(await screen.findByRole('status')).toHaveTextContent('載入中');
      expect(screen.queryByRole('heading', { name: '記帳紀錄' })).not.toBeInTheDocument();
      expect(requestLog.filter((r) => r.pathname.startsWith('/api/'))).toHaveLength(0);
    });
  });

  describe('Error', () => {
    it('liff.init 失敗時顯示「LIFF 初始化失敗」錯誤頁，不 render router、不發 API 請求', async () => {
      liffMock.init.mockRejectedValue(new Error('network down'));

      handle = await start();

      expect(await screen.findByRole('alert')).toHaveTextContent('LIFF 初始化失敗');
      expect(screen.queryByRole('heading', { name: '記帳紀錄' })).not.toBeInTheDocument();
      await waitFor(() =>
        expect(requestLog.filter((r) => r.pathname.startsWith('/api/'))).toHaveLength(0),
      );
    });
  });
});
