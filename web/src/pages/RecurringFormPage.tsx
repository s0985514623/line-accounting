import { useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useCategories } from '../api/categories';
import { useRecurringEntries, useSaveRecurringEntry } from '../api/recurring';
import type { TEntryType, TLedger, TRecurringEntry, TRecurringEntryInput } from '../api/schemas';
import { BackLink } from '../components/BackLink';
import { CategorySelect } from '../components/CategorySelect';
import { EntryTypeToggle } from '../components/EntryTypeToggle';
import { ErrorBanner } from '../components/ErrorBanner';
import { LedgerToggle } from '../components/LedgerToggle';
import { LoadingStatus } from '../components/LoadingStatus';
import { AMOUNT_MAX, ITEM_MAX_LENGTH, VALIDATION_MESSAGES } from '../lib/transaction-form';
import styles from './TransactionFormPage.module.css';

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

type TFormValues = {
  ledger: TLedger;
  entryType: TEntryType;
  item: string;
  amount: string;
  categoryId: string;
  dayOfMonth: string;
  note: string;
  active: boolean;
};

type TField = 'item' | 'amount' | 'categoryId';
type TErrors = Partial<Record<TField, string>>;

function toFormValues(entry: TRecurringEntry | undefined): TFormValues {
  if (!entry) {
    return {
      ledger: 'personal',
      entryType: 'expense',
      item: '',
      amount: '',
      categoryId: '',
      dayOfMonth: '1',
      note: '',
      active: true,
    };
  }
  return {
    ledger: entry.ledger,
    entryType: entry.entryType,
    item: entry.item,
    amount: String(entry.amount),
    categoryId: String(entry.categoryId),
    dayOfMonth: String(entry.dayOfMonth),
    note: entry.note ?? '',
    active: entry.active,
  };
}

function validate(values: TFormValues): TErrors {
  const errors: TErrors = {};
  const item = values.item.trim();
  if (item === '') errors.item = VALIDATION_MESSAGES.ITEM_REQUIRED;
  else if (item.length > ITEM_MAX_LENGTH) errors.item = VALIDATION_MESSAGES.ITEM_TOO_LONG;

  const amount = values.amount.trim();
  if (!/^\d+$/.test(amount) || Number(amount) < 1) errors.amount = VALIDATION_MESSAGES.AMOUNT_INVALID;
  else if (Number(amount) > AMOUNT_MAX) errors.amount = VALIDATION_MESSAGES.AMOUNT_TOO_LARGE;

  if (values.categoryId === '') errors.categoryId = VALIDATION_MESSAGES.CATEGORY_REQUIRED;
  return errors;
}

function toInput(values: TFormValues): TRecurringEntryInput {
  return {
    ledger: values.ledger,
    entryType: values.entryType,
    item: values.item.trim(),
    amount: Number(values.amount.trim()),
    categoryId: Number(values.categoryId),
    dayOfMonth: Number(values.dayOfMonth),
    note: values.note === '' ? null : values.note,
    active: values.active,
  };
}

function RecurringForm({ editing }: { editing?: TRecurringEntry }) {
  const navigate = useNavigate();
  const idPrefix = useId();
  const fieldId = (field: string) => `${idPrefix}-${field}`;
  const errorId = (field: TField) => `${idPrefix}-${field}-error`;

  const [values, setValues] = useState<TFormValues>(() => toFormValues(editing));
  const [errors, setErrors] = useState<TErrors>({});
  const isSubmittingRef = useRef(false);

  const categoriesQuery = useCategories(values.ledger, values.entryType);
  const saveMutation = useSaveRecurringEntry(editing?.id);

  const update = <K extends keyof TFormValues>(field: K, value: TFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const changeScope = (scope: { ledger?: TLedger; entryType?: TEntryType }) => {
    setValues((prev) => ({ ...prev, ...scope, categoryId: '' }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    const validationErrors = validate(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    isSubmittingRef.current = true;
    saveMutation.mutate(toInput(values), {
      onSuccess: () => navigate('/recurring'),
      onSettled: () => {
        isSubmittingRef.current = false;
      },
    });
  };

  const describedBy = (field: TField) => (errors[field] ? errorId(field) : undefined);
  const fieldError = (field: TField) =>
    errors[field] ? (
      <p id={errorId(field)} className={styles.fieldError}>
        {errors[field]}
      </p>
    ) : null;

  return (
    <form className={styles.form} noValidate onSubmit={handleSubmit}>
      {categoriesQuery.isError ? <ErrorBanner message={categoriesQuery.error.message} /> : null}
      {saveMutation.isError ? <ErrorBanner message={saveMutation.error.message} /> : null}

      <div className={styles.toggles}>
        <LedgerToggle value={values.ledger} onChange={(ledger) => changeScope({ ledger })} />
        <EntryTypeToggle
          value={values.entryType}
          onChange={(entryType) => changeScope({ entryType })}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor={fieldId('item')} className={styles.label}>
          項目
        </label>
        <input
          id={fieldId('item')}
          type="text"
          className={styles.input}
          autoComplete="off"
          placeholder="例如：房租、薪水、Netflix"
          value={values.item}
          aria-invalid={errors.item ? true : undefined}
          aria-describedby={describedBy('item')}
          onChange={(event) => update('item', event.target.value)}
        />
        {fieldError('item')}
      </div>

      <div className={styles.field}>
        <label htmlFor={fieldId('amount')} className={styles.label}>
          預設金額（每期入帳時可調整）
        </label>
        <input
          id={fieldId('amount')}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          className={styles.input}
          value={values.amount}
          aria-invalid={errors.amount ? true : undefined}
          aria-describedby={describedBy('amount')}
          onChange={(event) => update('amount', event.target.value)}
        />
        {fieldError('amount')}
      </div>

      <div className={styles.field}>
        <label htmlFor={fieldId('categoryId')} className={styles.label}>
          分類
        </label>
        <CategorySelect
          id={fieldId('categoryId')}
          className={styles.input}
          categories={categoriesQuery.data ?? []}
          value={values.categoryId}
          errorId={describedBy('categoryId')}
          onChange={(categoryId) => update('categoryId', categoryId)}
        />
        {fieldError('categoryId')}
      </div>

      <div className={styles.field}>
        <label htmlFor={fieldId('dayOfMonth')} className={styles.label}>
          每月幾號
        </label>
        <select
          id={fieldId('dayOfMonth')}
          className={styles.input}
          value={values.dayOfMonth}
          onChange={(event) => update('dayOfMonth', event.target.value)}
        >
          {DAYS.map((day) => (
            <option key={day} value={String(day)}>
              {day >= 29 ? `${day} 號（沒有這天的月份改在月底）` : `${day} 號`}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor={fieldId('note')} className={styles.label}>
          備註
        </label>
        <textarea
          id={fieldId('note')}
          rows={2}
          className={styles.input}
          value={values.note}
          onChange={(event) => update('note', event.target.value)}
        />
      </div>

      {editing ? (
        <label className={styles.label}>
          <input
            type="checkbox"
            checked={values.active}
            onChange={(event) => update('active', event.target.checked)}
          />{' '}
          啟用（停用後不再提醒）
        </label>
      ) : null}

      <button type="submit" className={styles.submit} disabled={saveMutation.isPending}>
        {saveMutation.isPending ? '儲存中…' : '儲存'}
      </button>
    </form>
  );
}

/** 固定收支表單頁：/recurring/new 新增、/recurring/edit/:id 編輯（資料取自規則列表）。 */
export function RecurringFormPage() {
  const { id } = useParams();
  const isEdit = id !== undefined;
  const entriesQuery = useRecurringEntries();

  const renderBody = () => {
    if (!isEdit) return <RecurringForm key="new" />;
    if (entriesQuery.isPending) return <LoadingStatus />;
    if (entriesQuery.isError) return <ErrorBanner message={entriesQuery.error.message} />;
    const editing = entriesQuery.data.find((entry) => String(entry.id) === id);
    if (!editing) return <ErrorBanner message="找不到這筆固定收支，請從列表重新選擇。" />;
    return <RecurringForm key={editing.id} editing={editing} />;
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BackLink />
        <h1 className={styles.title}>{isEdit ? '編輯固定收支' : '新增固定收支'}</h1>
      </header>
      {renderBody()}
    </main>
  );
}
