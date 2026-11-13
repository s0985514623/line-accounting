import { Link } from 'react-router';
import styles from './BackLink.module.css';

/**
 * 「返回列表」連結（預設導向 /）。LIFF 於 LINE 內開啟時沒有瀏覽器返回鍵，各子頁以此回到列表。
 * @param to 返回目的地（例如帶月份的列表 `/?month=2026-05&ledger=personal`）
 */
export function BackLink({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className={styles.backLink}>
      返回列表
    </Link>
  );
}
