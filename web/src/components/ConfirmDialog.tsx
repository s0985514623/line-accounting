import { useEffect, useId, useRef, type ReactNode } from 'react';
import styles from './ConfirmDialog.module.css';

type TConfirmDialogProps = {
  /** 對話框標題（亦為 dialog 的 accessible name） */
  title: string;
  /** 說明內容 */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** 確認動作進行中：兩顆按鈕皆 disabled */
  isBusy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * 確認對話框（role="dialog"、aria-modal）。開啟時聚焦「取消」，按 Esc 取消。
 * 由父層以條件渲染控制開關。
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = '取消',
  isBusy = false,
  onConfirm,
  onCancel,
}: TConfirmDialogProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className={styles.backdrop}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !isBusy) onCancel();
        }}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <div className={styles.body}>{children}</div>
        <div className={styles.actions}>
          <button
            ref={cancelRef}
            type="button"
            className={styles.cancel}
            disabled={isBusy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button type="button" className={styles.confirm} disabled={isBusy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
