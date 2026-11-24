import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useMediaQuery } from '../lib/use-media-query';
import { isInLineApp, logout } from '../liff/liff-client';
import styles from './AppShell.module.css';

export const DESKTOP_QUERY = '(min-width: 1024px)';

const NAV_ITEMS: ReadonlyArray<{ to: string; label: string; end?: boolean }> = [
  { to: '/', label: '記帳紀錄', end: true },
  { to: '/new', label: '新增記帳' },
  { to: '/batch', label: '批次記帳' },
  { to: '/recurring', label: '固定收支' },
  { to: '/categories', label: '分類管理' },
  { to: '/chart', label: '統計圖表' },
  { to: '/annual', label: '年度報表' },
];

/**
 * 版面外框：桌機（≥1024px）顯示左側導覽側欄；手機 / LINE 內維持原本單欄版面（不 render 側欄）。
 * 外部瀏覽器額外提供「登出」。
 */
export function AppShell({ children }: { children: ReactNode }) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  if (!isDesktop) return <>{children}</>;

  const showLogout = !isInLineApp();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>LINE 記帳</div>
        <nav aria-label="側欄選單" className={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                isActive ? `${styles.navLink} ${styles.active}` : styles.navLink
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        {showLogout ? (
          <button type="button" className={styles.logout} onClick={logout}>
            登出
          </button>
        ) : null}
      </aside>
      <div className={styles.content} data-layout="desktop">
        {children}
      </div>
    </div>
  );
}
