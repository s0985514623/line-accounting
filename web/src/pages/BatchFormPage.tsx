import { useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useCategories } from '../api/categories';
import type { TCategory, TEntryType, TLedger } from '../api/schemas';
import { useCreateTransactionsBatch } from '../api/transactions';
import { BackLink } from '../components/BackLink';
import { CategorySelect } from '../components/CategorySelect';
import { EntryTypeToggle } from '../components/EntryTypeToggle';
import { ErrorBanner } from '../components/ErrorBanner';
import { LedgerToggle } from '../components/LedgerToggle';
import {
  BATCH_MAX_ROWS,
  createEmptyRow,
  hasBatchErrors,
  isBlankRow,
  toBatchInputs,
  validateBatch,
  type TBatchRow,
  type TBatchRowErrors,
  type TBatchRowField,
} from '../lib/batch-form';
import { taipeiToday } from '../lib/date';
import styles from './BatchFormPage.module.css';

const INITIAL_ROWS = 3;

type TBatchRowEditorProps = {
  index: number;
  row: TBatchRow;
  errors: TBatchRowErrors | undefined;
  categories: readonly TCategory[];
  canRemove: boolean;
  onChange: (field: TBatchRowField, value: string) => void;
  onItemBlur: () => void;
  onRemove: () => void;
};

/** 單筆（卡片）：項目、金額、分類、日期、備註。label 帶序號，方便螢幕閱讀器區分各筆。 */
function BatchRowEditor({
  index,
  row,
  errors,
  categories,
  canRemove,
  onChange,
  onItemBlur,
  onRemove,
}: TBatchRowEditorProps) {
  const idPrefix = useId();
  const fieldId = (field: TBatchRowField) => `${idPrefix}-${field}`;
  const errorId = (field: keyof TBatchRowErrors) =>
    errors?.[field] ? `${idPrefix}-${field}-error` : undefined;
  const number = index + 1;

  const fieldError = (field: keyof TBatchRowErrors) =>
    errors?.[field] ? (
      <p id={errorId(field)} className={styles.fieldError}>
        {errors[field]}
      </p>
    ) : null;

  return (
    <li className={styles.row} aria-label={`第 ${number} 筆`}>
      <div className={styles.rowHeader}>
        <span className={styles.rowNumber}>第 {number} 筆</span>
        {canRemove ? (
          <button type="button" className={styles.removeButton} onClick={onRemove}>
            移除第 {number} 筆
          </button>
        ) : null}
      </div>

      <div className={styles.grid}>
        <div className={styles.field}>
          <label htmlFor={fieldId('item')} className={styles.label}>
            項目 {number}
          </label>
          <input
            id={fieldId('item')}
            type="text"
            className={styles.input}
            autoComplete="off"
            value={row.item}
            aria-invalid={errors?.item ? true : undefined}
            aria-describedby={errorId('item')}
            onChange={(event) => onChange('item', event.target.value)}
            onBlur={onItemBlur}
          />
          {fieldError('item')}
        </div>

        <div className={styles.field}>
          <label htmlFor={fieldId('amount')} className={styles.label}>
            金額 {number}
          </label>
          <input
            id={fieldId('amount')}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            className={styles.input}
            value={row.amount}
            aria-invalid={errors?.amount ? true : undefined}
            aria-describedby={errorId('amount')}
            onChange={(event) => onChange('amount', event.target.value)}
          />
          {fieldError('amount')}
        </div>

        <div className={styles.field}>
          <label htmlFor={fieldId('categoryId')} className={styles.label}>
            分類 {number}
          </label>
          <CategorySelect
            id={fieldId('categoryId')}
            className={styles.input}
            categories={categories}
            value={row.categoryId}
            errorId={errorId('categoryId')}
            onChange={(categoryId) => onChange('categoryId', categoryId)}
          />
          {fieldError('categoryId')}
        </div>

        <div className={styles.field}>
          <label htmlFor={fieldId('occurredOn')} className={styles.label}>
            日期 {number}
          </label>
          <input
            id={fieldId('occurredOn')}
            type="date"
            className={styles.input}
            value={row.occurredOn}
            aria-invalid={errors?.occurredOn ? true : undefined}
            aria-describedby={errorId('occurredOn')}
            onChange={(event) => onChange('occurredOn', event.target.value)}
          />
          {fieldError('occurredOn')}
        </div>

        <div className={`${styles.field} ${styles.full}`}>
          <label htmlFor={fieldId('note')} className={styles.label}>
            備註 {number}
          </label>
          <input
            id={fieldId('note')}
            type="text"
            className={styles.input}
            autoComplete="off"
            value={row.note}
            onChange={(event) => onChange('note', event.target.value)}
          />
        </div>
      </div>
    </li>
  );
}

/**
 * 批次記帳頁（/batch）：帳本、收支整批共用，每筆各選分類與日期。
 *  - 「預設日期」改變時，日期仍等於舊預設值的各筆一起改（已個別改過的不動）；新增的筆數用預設日期。
 *  - 項目離開焦點時，若尚未選分類且項目名稱與某分類同名，自動選該分類。
 *  - 項目與金額都空白的筆數略過；任一筆驗證失敗則不送出。成功後回列表。
 */
export function BatchFormPage() {
  const navigate = useNavigate();
  const defaultDateId = useId();
  const [ledger, setLedger] = useState<TLedger>('personal');
  const [entryType, setEntryType] = useState<TEntryType>('expense');
  const [defaultDate, setDefaultDate] = useState(() => taipeiToday());
  const [rows, setRows] = useState<TBatchRow[]>(() =>
    Array.from({ length: INITIAL_ROWS }, () => createEmptyRow(defaultDate)),
  );
  const [rowErrors, setRowErrors] = useState<Record<number, TBatchRowErrors>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const isSubmittingRef = useRef(false);

  const categoriesQuery = useCategories(ledger, entryType);
  const categories = categoriesQuery.data ?? [];
  const batchMutation = useCreateTransactionsBatch();

  /** 帳本／收支改變時，各筆已選的分類不再適用 → 清空。 */
  const changeScope = (scope: { ledger?: TLedger; entryType?: TEntryType }) => {
    if (scope.ledger) setLedger(scope.ledger);
    if (scope.entryType) setEntryType(scope.entryType);
    setRows((prev) => prev.map((row) => ({ ...row, categoryId: '' })));
  };

  const changeDefaultDate = (next: string) => {
    setRows((prev) =>
      prev.map((row) => (row.occurredOn === defaultDate ? { ...row, occurredOn: next } : row)),
    );
    setDefaultDate(next);
  };

  const updateRow = (key: number, field: TBatchRowField, value: string) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
    setRowErrors((prev) => {
      const current = prev[key];
      if (!current || !(field in current)) return prev;
      return { ...prev, [key]: { ...current, [field]: undefined } };
    });
  };

  const suggestCategory = (key: number) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.key !== key || row.categoryId !== '') return row;
        const match = categories.find((category) => category.name === row.item.trim());
        return match ? { ...row, categoryId: String(match.id) } : row;
      }),
    );
  };

  const addRow = () => setRows((prev) => [...prev, createEmptyRow(defaultDate)]);
  const removeRow = (key: number) => setRows((prev) => prev.filter((row) => row.key !== key));

  const filledCount = rows.filter((row) => !isBlankRow(row)).length;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;

    const validation = validateBatch(ledger, entryType, rows);
    setRowErrors(validation.rowErrors);
    setFormError(validation.formError);
    if (hasBatchErrors(validation)) return;

    isSubmittingRef.current = true;
    batchMutation.mutate(toBatchInputs(ledger, entryType, rows), {
      onSuccess: () => navigate('/'),
      onSettled: () => {
        isSubmittingRef.current = false;
      },
    });
  };

  const isSaving = batchMutation.isPending;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BackLink />
        <h1 className={styles.title}>批次記帳</h1>
      </header>

      <form className={styles.form} noValidate onSubmit={handleSubmit}>
        {categoriesQuery.isError ? <ErrorBanner message={categoriesQuery.error.message} /> : null}
        {batchMutation.isError ? <ErrorBanner message={batchMutation.error.message} /> : null}
        {formError ? <ErrorBanner message={formError} /> : null}

        <section className={styles.shared} aria-label="整批設定">
          <div className={styles.toggles}>
            <LedgerToggle value={ledger} onChange={(next) => changeScope({ ledger: next })} />
            <EntryTypeToggle
              value={entryType}
              onChange={(next) => changeScope({ entryType: next })}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={defaultDateId} className={styles.label}>
              預設日期
            </label>
            <input
              id={defaultDateId}
              type="date"
              className={styles.input}
              value={defaultDate}
              onChange={(event) => changeDefaultDate(event.target.value)}
            />
          </div>
        </section>

        <ol className={styles.rows}>
          {rows.map((row, index) => (
            <BatchRowEditor
              key={row.key}
              index={index}
              row={row}
              errors={rowErrors[row.key]}
              categories={categories}
              canRemove={rows.length > 1}
              onChange={(field, value) => updateRow(row.key, field, value)}
              onItemBlur={() => suggestCategory(row.key)}
              onRemove={() => removeRow(row.key)}
            />
          ))}
        </ol>

        <button
          type="button"
          className={styles.addButton}
          onClick={addRow}
          disabled={rows.length >= BATCH_MAX_ROWS}
        >
          ＋ 再加一筆
        </button>

        <button type="submit" className={styles.submit} disabled={isSaving}>
          {isSaving ? '儲存中…' : `儲存 ${filledCount} 筆`}
        </button>
      </form>
    </main>
  );
}
