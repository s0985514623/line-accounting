import { useRef, useState } from 'react';
import { Link } from 'react-router';
import type { TLedger, TTransaction } from '../api/schemas';
import { useDeleteTransaction, useTransactions } from '../api/transactions';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { LedgerToggle } from '../components/LedgerToggle';
import { LoadingStatus } from '../components/LoadingStatus';
import { MonthPicker } from '../components/MonthPicker';
import { formatShortDate, taipeiCurrentMonth } from '../lib/date';
import { createEditRouteState } from '../lib/edit-route-state';
import { formatAmount } from '../lib/format';
import styles from './TransactionListPage.module.css';

type TTransactionRowProps = {
  transaction: TTransaction;
  onDelete: (transaction: TTransaction) => void;
};

/**
 * 列表中的單筆紀錄：整列為編輯連結，右側為刪除按鈕。
 */
function TransactionRow({ transaction, onDelete }: TTransactionRowProps) {
  const { id, item, note, amount, entryType, categoryName, occurredOn } = transaction;
  const isIncome = entryType === 'income';

  return (
    <li className={styles.row}>
      <Link to={`/edit/${id}`} state={createEditRouteState(transaction)} className={styles.rowLink}>
        <span className={styles.rowMain}>
          <span className={styles.item}>{item}</span>
          {note ? <span className={styles.note}>{note}</span> : null}
          <span className={styles.meta}>
            {formatShortDate(occurredOn)} · {categoryName}
          </span>
        </span>
        <span className={isIncome ? styles.amountIncome : styles.amountExpense}>
          {`${isIncome ? '+' : '-'}${formatAmount(amount)}`}
        </span>
      </Link>
      <button
        type="button"
        className={styles.deleteButton}
        aria-label={`刪除${item}`}
        onClick={() => onDelete(transaction)}
      >
        刪除
      </button>
    </li>
  );
}

/**
 * 記帳紀錄列表頁（/liff/）：月份與帳本篩選、列表、刪除確認。
 * 列表順序依 API 回傳（日期新到舊、同日 id 大到小），前端不重排。
 */
export function TransactionListPage() {
  const [month, setMonth] = useState(() => taipeiCurrentMonth());
  const [ledger, setLedger] = useState<TLedger>('personal');
  const [pendingDelete, setPendingDelete] = useState<TTransaction | null>(null);
  const isDeletingRef = useRef(false);

  const transactionsQuery = useTransactions(month, ledger);
  const deleteMutation = useDeleteTransaction();

  const handleConfirmDelete = () => {
    // 以 ref 擋住連點：第二次點擊可能早於 isPending 的重新渲染
    if (!pendingDelete || isDeletingRef.current) return;
    isDeletingRef.current = true;
    deleteMutation.mutate(pendingDelete.id, {
      onSettled: () => {
        isDeletingRef.current = false;
        setPendingDelete(null);
      },
    });
  };

  const handleRequestDelete = (transaction: TTransaction) => {
    deleteMutation.reset();
    setPendingDelete(transaction);
  };

  const renderContent = () => {
    if (transactionsQuery.isPending) return <LoadingStatus />;
    if (transactionsQuery.isError) return <ErrorBanner message={transactionsQuery.error.message} />;
    if (transactionsQuery.data.length === 0) {
      return <p className={styles.empty}>本月尚無紀錄</p>;
    }
    return (
      <ul className={styles.list}>
        {transactionsQuery.data.map((transaction) => (
          <TransactionRow
            key={transaction.id}
            transaction={transaction}
            onDelete={handleRequestDelete}
          />
        ))}
      </ul>
    );
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>記帳紀錄</h1>
        <Link to="/new" className={styles.addLink}>
          新增記帳
        </Link>
      </header>

      <section className={styles.filters}>
        <MonthPicker value={month} onChange={setMonth} />
        <LedgerToggle value={ledger} onChange={setLedger} />
      </section>

      {deleteMutation.isError ? <ErrorBanner message={deleteMutation.error.message} /> : null}

      {renderContent()}

      {pendingDelete ? (
        <ConfirmDialog
          title="刪除記帳紀錄"
          confirmLabel="確認刪除"
          isBusy={deleteMutation.isPending}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        >
          <p
            className={styles.dialogText}
          >{`確定要刪除「${pendingDelete.item}」嗎？刪除後無法復原。`}</p>
        </ConfirmDialog>
      ) : null}
    </main>
  );
}
