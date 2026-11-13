import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import type { TCategoryShare, TEntryType, TLedger, TTransaction } from '../api/schemas';
import { useTransactions } from '../api/transactions';
import { formatShortDate } from '../lib/date';
import { createEditRouteState } from '../lib/edit-route-state';
import { formatAmount } from '../lib/format';
import { ErrorBanner } from './ErrorBanner';
import { LoadingStatus } from './LoadingStatus';
import styles from './CategoryDrilldown.module.css';

type TCategoryDrilldownProps = {
  month: string;
  ledger: TLedger;
  entryType: TEntryType;
  share: TCategoryShare;
  /** 展開時捲動到可見範圍（由圓餅圖點擊展開時使用） */
  scrollIntoView?: boolean;
};

/** 屬於該分類的紀錄：有 categoryId 以 id 比對，否則以分類名稱比對（同帳本同收支名稱唯一）。 */
export function filterCategoryTransactions(
  transactions: readonly TTransaction[],
  entryType: TEntryType,
  share: TCategoryShare,
): TTransaction[] {
  return transactions.filter(
    (transaction) =>
      transaction.entryType === entryType &&
      (share.categoryId !== undefined
        ? transaction.categoryId === share.categoryId
        : transaction.categoryName === share.categoryName),
  );
}

/**
 * 分類細項：該月、該帳本、該分類的每筆紀錄（順序依列表 API：日期新到舊）。
 * 與列表頁共用 transactions 查詢快取；每筆可點進編輯頁。
 */
export function CategoryDrilldown({
  month,
  ledger,
  entryType,
  share,
  scrollIntoView = false,
}: TCategoryDrilldownProps) {
  const query = useTransactions(month, ledger);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollIntoView) containerRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [scrollIntoView]);

  const renderBody = () => {
    if (query.isPending) return <LoadingStatus />;
    if (query.isError) return <ErrorBanner message={query.error.message} />;
    const items = filterCategoryTransactions(query.data, entryType, share);
    if (items.length === 0) return <p className={styles.empty}>沒有紀錄</p>;
    return (
      <ul className={styles.list}>
        {items.map((transaction) => (
          <li key={transaction.id}>
            <Link
              to={`/edit/${transaction.id}`}
              state={createEditRouteState(transaction)}
              className={styles.link}
            >
              <span className={styles.date}>{formatShortDate(transaction.occurredOn)}</span>
              <span className={styles.main}>
                <span className={styles.item}>{transaction.item}</span>
                {transaction.note ? <span className={styles.note}>{transaction.note}</span> : null}
              </span>
              <span className={styles.amount}>{formatAmount(transaction.amount)}</span>
            </Link>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div
      ref={containerRef}
      role="region"
      className={styles.container}
      aria-label={`${share.categoryName}細項`}
    >
      {renderBody()}
    </div>
  );
}
