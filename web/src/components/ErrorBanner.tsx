import styles from './ErrorBanner.module.css';

type TErrorBannerProps = {
  /** 要顯示的錯誤訊息（中文對照後的文字） */
  message: string;
};

/**
 * 錯誤提示橫幅（role="alert"），訊息以純文字呈現。
 */
export function ErrorBanner({ message }: TErrorBannerProps) {
  return (
    <div role="alert" className={styles.banner}>
      {message}
    </div>
  );
}
