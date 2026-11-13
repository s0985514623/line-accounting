import { useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { ledgerSchema, type TLedger, type TTransaction } from '../api/schemas';
import { useDeleteTransaction, useTransactions } from '../api/transactions';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { LedgerToggle } from '../components/LedgerToggle';
import { LoadingStatus } from '../components/LoadingStatus';
import { MonthPicker } from '../components/MonthPicker';
import { formatShortDate, isValidMonth, taipeiCurrentMonth } from '../lib/date';
import { createEditRouteState } from '../lib/edit-route-state';
import { formatAmount } from '../lib/format';
import styles from './TransactionListPage.module.css';

type TTransactionRowProps = {
  transaction: TTransaction;
  /** 編輯後要回到的列表路徑（含月份 / 帳本） */
  returnTo: string;
  onDelete: (transaction: TTransaction) => void;
};

/**
 * 列表中的單筆紀錄：整列為編輯連結，右側為刪除按鈕。
 */
function TransactionRow({ transaction, returnTo, onDelete }: TTransactionRowProps) {
  const { id, item, note, amount, entryType, categoryName, occurredOn } = transaction;
  const isIncome = entryType === 'income';

  return (
    <li className={styles.row}>
      <Link
        to={`/edit/${id}`}
        state={createEditRouteState(transaction, returnTo)}
        className={styles.rowLink}
      >
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
 * 月份與帳本放在網址（?month=YYYY-MM&ledger=），從編輯頁返回時維持原本的月份 / 帳本；
 * 缺省或不合法時為本月（Asia/Taipei）/ 個人。
 */
export function TransactionListPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawMonth = searchParams.get('month') ?? '';
  const month = isValidMonth(rawMonth) ? rawMonth : taipeiCurrentMonth();
  const parsedLedger = ledgerSchema.safeParse(searchParams.get('ledger'));
  const ledger: TLedger = parsedLedger.success ? parsedLedger.data : 'personal';
  const returnTo = `${location.pathname}${location.search}`;

  const updateParams = (next: { month: string; ledger: TLedger }) => {
    setSearchParams({ month: next.month, ledger: next.ledger }, { replace: true });
  };
  const setMonth = (nextMonth: string) => updateParams({ month: nextMonth, ledger });
  const setLedger = (nextLedger: TLedger) => updateParams({ month, ledger: nextLedger });
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
            returnTo={returnTo}
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

      <nav aria-label="功能選單" className={styles.nav}>
        <Link to="/batch" className={styles.navLink}>
          批次記帳
        </Link>
        <Link to="/categories" className={styles.navLink}>
          分類管理
        </Link>
        <Link
          to={{ pathname: '/chart', search: `?month=${month}&ledger=${ledger}` }}
          className={styles.navLink}
        >
          統計圖表
        </Link>
      </nav>

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
