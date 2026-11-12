import { Link } from 'react-router';
import styles from './BackLink.module.css';

/**
 * 「返回列表」連結（導向 /）。LIFF 於 LINE 內開啟時沒有瀏覽器返回鍵，各子頁以此回到列表。
 */
export function BackLink() {
  return (
    <Link to="/" className={styles.backLink}>
      返回列表
    </Link>
  );
}
