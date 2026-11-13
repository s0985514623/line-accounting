import { useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  useDeleteRecurringEntry,
  usePendingOccurrences,
  useRecurringEntries,
  useToggleRecurringEntry,
} from '../api/recurring';
import type { TRecurringEntry, TRecurringOccurrence } from '../api/schemas';
import { BackLink } from '../components/BackLink';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingStatus } from '../components/LoadingStatus';
import { formatShortDate } from '../lib/date';
import { formatAmount } from '../lib/format';
import styles from './RecurringPage.module.css';

const LEDGER_LABELS = { personal: '個人', company: '公司' } as const;

function signedAmount(entryType: 'expense' | 'income', amount: number): string {
  return `${entryType === 'income' ? '+' : '-'}${formatAmount(amount)}`;
}

function OccurrenceRow({ occurrence }: { occurrence: TRecurringOccurrence }) {
  const isIncome = occurrence.entryType === 'income';
  return (
    <li className={styles.row}>
      <Link to={`/recurring/occurrences/${occurrence.id}`} className={styles.rowLink}>
        <span className={styles.rowMain}>
          <span className={styles.item}>{occurrence.item}</span>
          <span className={styles.meta}>
            {formatShortDate(occurrence.dueOn)} 到期 · {LEDGER_LABELS[occurrence.ledger]} ·{' '}
            {occurrence.categoryName}
          </span>
        </span>
        <span className={isIncome ? styles.amountIncome : styles.amountExpense}>
          {signedAmount(occurrence.entryType, occurrence.amount)}
        </span>
      </Link>
      <span className={styles.action}>處理</span>
    </li>
  );
}

type TEntryRowProps = {
  entry: TRecurringEntry;
  onToggle: (entry: TRecurringEntry) => void;
  onDelete: (entry: TRecurringEntry) => void;
  isBusy: boolean;
};

function EntryRow({ entry, onToggle, onDelete, isBusy }: TEntryRowProps) {
  const isIncome = entry.entryType === 'income';
  return (
    <li className={entry.active ? styles.row : `${styles.row} ${styles.inactive}`}>
      <Link to={`/recurring/edit/${entry.id}`} className={styles.rowLink}>
        <span className={styles.rowMain}>
          <span className={styles.item}>
            {entry.item}
            {entry.active ? null : <span className={styles.tag}>停用中</span>}
          </span>
          <span className={styles.meta}>
            每月 {entry.dayOfMonth} 號 · {LEDGER_LABELS[entry.ledger]} · {entry.categoryName}
            {entry.active ? ` · 下次 ${formatShortDate(entry.nextDueOn)}` : ''}
          </span>
        </span>
        <span className={isIncome ? styles.amountIncome : styles.amountExpense}>
          {signedAmount(entry.entryType, entry.amount)}
        </span>
      </Link>
      <button
        type="button"
        className={styles.toggleButton}
        aria-label={`${entry.active ? '停用' : '啟用'}${entry.item}`}
        disabled={isBusy}
        onClick={() => onToggle(entry)}
      >
        {entry.active ? '停用' : '啟用'}
      </button>
      <button
        type="button"
        className={styles.deleteButton}
        aria-label={`刪除${entry.item}`}
        onClick={() => onDelete(entry)}
      >
        刪除
      </button>
    </li>
  );
}

/**
 * 每月固定收支頁（/liff/recurring）：待確認的各期 + 規則列表（編輯、停用 / 啟用、刪除）。
 */
export function RecurringPage() {
  const entriesQuery = useRecurringEntries();
  const occurrencesQuery = usePendingOccurrences();
  const toggleMutation = useToggleRecurringEntry();
  const deleteMutation = useDeleteRecurringEntry();
  const [pendingDelete, setPendingDelete] = useState<TRecurringEntry | null>(null);
  const isDeletingRef = useRef(false);

  const handleConfirmDelete = () => {
    if (!pendingDelete || isDeletingRef.current) return;
    isDeletingRef.current = true;
    deleteMutation.mutate(pendingDelete.id, {
      onSettled: () => {
        isDeletingRef.current = false;
        setPendingDelete(null);
      },
    });
  };

  const renderOccurrences = () => {
    if (occurrencesQuery.isPending) return null;
    if (occurrencesQuery.isError) return <ErrorBanner message={occurrencesQuery.error.message} />;
    if (occurrencesQuery.data.length === 0) return null;
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>待確認（{occurrencesQuery.data.length}）</h2>
        <ul className={styles.list}>
          {occurrencesQuery.data.map((occurrence) => (
            <OccurrenceRow key={occurrence.id} occurrence={occurrence} />
          ))}
        </ul>
      </section>
    );
  };

  const renderEntries = () => {
    if (entriesQuery.isPending) return <LoadingStatus />;
    if (entriesQuery.isError) return <ErrorBanner message={entriesQuery.error.message} />;
    if (entriesQuery.data.length === 0) {
      return <p className={styles.empty}>還沒有固定收支。新增後，每月到期日會用 LINE 通知你確認入帳。</p>;
    }
    return (
      <ul className={styles.list}>
        {entriesQuery.data.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            isBusy={toggleMutation.isPending}
            onToggle={(target) => {
              deleteMutation.reset();
              toggleMutation.mutate(target);
            }}
            onDelete={(target) => {
              toggleMutation.reset();
              deleteMutation.reset();
              setPendingDelete(target);
            }}
          />
        ))}
      </ul>
    );
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BackLink />
        <h1 className={styles.title}>固定收支</h1>
      </header>

      <Link to="/recurring/new" className={styles.addLink}>
        ＋ 新增固定收支
      </Link>

      {renderOccurrences()}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>每月固定</h2>
        {toggleMutation.isError ? <ErrorBanner message={toggleMutation.error.message} /> : null}
        {deleteMutation.isError ? <ErrorBanner message={deleteMutation.error.message} /> : null}
        {renderEntries()}
        <p className={styles.hint}>
          每月到期日早上 9 點會用 LINE 推播，按「確認入帳」才會記帳；設定 29–31 號時，較短的月份改在月底。
        </p>
      </section>

      {pendingDelete ? (
        <ConfirmDialog
          title="刪除固定收支"
          confirmLabel="確認刪除"
          isBusy={deleteMutation.isPending}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        >
          <p className={styles.dialogText}>
            {`確定要刪除「${pendingDelete.item}」嗎？已入帳的紀錄會保留，尚未確認的各期會一併移除。`}
          </p>
        </ConfirmDialog>
      ) : null}
    </main>
  );
}
