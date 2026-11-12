import styles from './LoadingStatus.module.css';

/**
 * 載入中提示（role="status"，供輔助科技朗讀）。
 */
export function LoadingStatus() {
  return (
    <div role="status" className={styles.status}>
      載入中…
    </div>
  );
}
