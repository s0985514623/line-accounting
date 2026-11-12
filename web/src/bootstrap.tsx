import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LoadingStatus } from './components/LoadingStatus';
import { initLiff } from './liff/liff-client';
import styles from './bootstrap.module.css';

export type TBootstrapHandle = {
  unmount(): void;
};

/** LIFF 初始化失敗的錯誤頁（不 render router、不發 API 請求）。 */
function LiffInitError() {
  return (
    <main className={styles.errorPage}>
      <div role="alert" className={styles.errorBox}>
        LIFF 初始化失敗，請關閉頁面後重新開啟。
      </div>
    </main>
  );
}

/**
 * 啟動流程（R9）：
 * 1. 立即 render 載入中
 * 2. await initLiff()：'ready' 才 render App；'redirecting' 維持載入中；拋錯則 render 錯誤頁
 * @param container 掛載點（#root）
 * @returns 任一分支 render 完成後 resolve；可用 unmount() 卸載
 */
export async function bootstrap(container: HTMLElement): Promise<TBootstrapHandle> {
  const root = createRoot(container);
  const render = (node: ReactNode) => root.render(<StrictMode>{node}</StrictMode>);

  render(<LoadingStatus />);

  try {
    const status = await initLiff();
    if (status === 'ready') render(<App />);
  } catch (error) {
    console.error('LIFF 初始化失敗', error);
    render(<LiffInitError />);
  }

  return { unmount: () => root.unmount() };
}
