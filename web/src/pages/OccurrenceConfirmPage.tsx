import { useId, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { usePendingOccurrences, useResolveOccurrence } from '../api/recurring';
import type { TRecurringOccurrence } from '../api/schemas';
import { BackLink } from '../components/BackLink';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingStatus } from '../components/LoadingStatus';
import { formatAmount } from '../lib/format';
import { AMOUNT_MAX, VALIDATION_MESSAGES } from '../lib/transaction-form';
import styles from './TransactionFormPage.module.css';

const LEDGER_LABELS = { personal: '個人', company: '公司' } as const;
const ENTRY_TYPE_LABELS = { expense: '支出', income: '收入' } as const;

function validateAmount(amount: string): string | undefined {
  const trimmed = amount.trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1) return VALIDATION_MESSAGES.AMOUNT_INVALID;
  if (Number(trimmed) > AMOUNT_MAX) return VALIDATION_MESSAGES.AMOUNT_TOO_LARGE;
  return undefined;
}

function ConfirmForm({ occurrence }: { occurrence: TRecurringOccurrence }) {
  const navigate = useNavigate();
  const amountId = useId();
  const [amount, setAmount] = useState(String(occurrence.amount));
  const [amountError, setAmountError] = useState<string | undefined>();
  const isSubmittingRef = useRef(false);
  const resolveMutation = useResolveOccurrence();

  const resolve = (action: 'confirm' | 'skip') => {
    if (isSubmittingRef.current) return;
    let parsedAmount: number | undefined;
    if (action === 'confirm') {
      const error = validateAmount(amount);
      setAmountError(error);
      if (error) return;
      parsedAmount = Number(amount.trim());
    }
    isSubmittingRef.current = true;
    resolveMutation.mutate(
      { id: occurrence.id, action, ...(parsedAmount !== undefined && { amount: parsedAmount }) },
      {
        onSuccess: () => navigate(action === 'confirm' ? '/' : '/recurring'),
        onSettled: () => {
          isSubmittingRef.current = false;
        },
      },
    );
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resolve('confirm');
  };

  return (
    <form className={styles.form} noValidate onSubmit={handleSubmit}>
      {resolveMutation.isError ? <ErrorBanner message={resolveMutation.error.message} /> : null}

      <div className={styles.field}>
        <span className={styles.label}>項目</span>
        <span>
          {occurrence.item}
          {occurrence.note ? `（${occurrence.note}）` : ''}
        </span>
      </div>
      <div className={styles.field}>
        <span className={styles.label}>帳本 / 收支 / 分類</span>
        <span>
          {LEDGER_LABELS[occurrence.ledger]} · {ENTRY_TYPE_LABELS[occurrence.entryType]} ·{' '}
          {occurrence.categoryName}
        </span>
      </div>
      <div className={styles.field}>
        <span className={styles.label}>入帳日期</span>
        <span>{occurrence.dueOn}</span>
      </div>

      <div className={styles.field}>
        <label htmlFor={amountId} className={styles.label}>
          本期金額（預設 {formatAmount(occurrence.amount)}）
        </label>
        <input
          id={amountId}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          className={styles.input}
          value={amount}
          aria-invalid={amountError ? true : undefined}
          aria-describedby={amountError ? `${amountId}-error` : undefined}
          onChange={(event) => {
            setAmount(event.target.value);
            setAmountError(undefined);
          }}
        />
        {amountError ? (
          <p id={`${amountId}-error`} className={styles.fieldError}>
            {amountError}
          </p>
        ) : null}
      </div>

      <button type="submit" className={styles.submit} disabled={resolveMutation.isPending}>
        {resolveMutation.isPending ? '處理中…' : '確認入帳'}
      </button>
      <button
        type="button"
        className={styles.secondary}
        disabled={resolveMutation.isPending}
        onClick={() => resolve('skip')}
      >
        這期略過
      </button>
    </form>
  );
}

/** 確認某一期固定收支（/recurring/occurrences/:id）：可調整金額後入帳，或略過。 */
export function OccurrenceConfirmPage() {
  const { id } = useParams();
  const occurrencesQuery = usePendingOccurrences();

  const renderBody = () => {
    if (occurrencesQuery.isPending) return <LoadingStatus />;
    if (occurrencesQuery.isError) return <ErrorBanner message={occurrencesQuery.error.message} />;
    const occurrence = occurrencesQuery.data.find((item) => String(item.id) === id);
    if (!occurrence) {
      return (
        <>
          <ErrorBanner message="這期固定收支已處理過（已入帳或已略過），或已被刪除。" />
          <p>
            <Link to="/recurring">回固定收支列表</Link>
          </p>
        </>
      );
    }
    return <ConfirmForm occurrence={occurrence} />;
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BackLink />
        <h1 className={styles.title}>確認固定收支</h1>
      </header>
      {renderBody()}
    </main>
  );
}
