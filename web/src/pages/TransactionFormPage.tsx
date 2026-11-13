import { useId, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useCategories } from '../api/categories';
import type { TEntryType, TLedger, TTransaction } from '../api/schemas';
import { useSaveTransaction } from '../api/transactions';
import { BackLink } from '../components/BackLink';
import { CategorySelect } from '../components/CategorySelect';
import { EntryTypeToggle } from '../components/EntryTypeToggle';
import { ErrorBanner } from '../components/ErrorBanner';
import { LedgerToggle } from '../components/LedgerToggle';
import { taipeiToday } from '../lib/date';
import { readEditRouteState, readReturnTo } from '../lib/edit-route-state';
import {
  createEmptyFormValues,
  toFormValues,
  toTransactionInput,
  validateFormValues,
  type TTransactionFormErrors,
  type TTransactionFormField,
  type TTransactionFormValues,
} from '../lib/transaction-form';
import styles from './TransactionFormPage.module.css';

type TFieldErrorProps = {
  id: string;
  message: string | undefined;
};

/** 欄位下方的驗證訊息（純文字；不使用 role=alert，避免與送出錯誤混淆）。 */
function FieldError({ id, message }: TFieldErrorProps) {
  if (!message) return null;
  return (
    <p id={id} className={styles.fieldError}>
      {message}
    </p>
  );
}

type TTransactionFormProps = {
  /** 編輯中的紀錄；新增模式為 undefined */
  editing?: TTransaction;
  /** 儲存成功後導向的路徑 */
  returnTo: string;
};

/**
 * 記帳表單本體（新增／編輯共用）。
 * 切換帳本或收支時重新載入分類並清空已選分類；送出中 disabled 並以 ref 防止重複送出。
 */
function TransactionForm({ editing, returnTo }: TTransactionFormProps) {
  const navigate = useNavigate();
  const idPrefix = useId();
  const fieldId = (field: TTransactionFormField) => `${idPrefix}-${field}`;
  const errorId = (field: TTransactionFormField) => `${idPrefix}-${field}-error`;

  const [values, setValues] = useState<TTransactionFormValues>(() =>
    editing ? toFormValues(editing) : createEmptyFormValues(taipeiToday()),
  );
  const [errors, setErrors] = useState<TTransactionFormErrors>({});
  const isSubmittingRef = useRef(false);

  const categoriesQuery = useCategories(values.ledger, values.entryType);
  const saveMutation = useSaveTransaction(editing?.id);

  const updateField = <K extends TTransactionFormField>(
    field: K,
    value: TTransactionFormValues[K],
  ) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  /** 帳本／收支改變時，舊分類已不適用 → 清空。 */
  const changeScope = (scope: { ledger?: TLedger; entryType?: TEntryType }) => {
    setValues((prev) => ({ ...prev, ...scope, categoryId: '' }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;

    const validationErrors = validateFormValues(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    isSubmittingRef.current = true;
    saveMutation.mutate(toTransactionInput(values), {
      onSuccess: () => navigate(returnTo),
      onSettled: () => {
        isSubmittingRef.current = false;
      },
    });
  };

  const describedBy = (field: TTransactionFormField) =>
    errors[field] ? errorId(field) : undefined;
  const isSaving = saveMutation.isPending;

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
          value={values.item}
          aria-invalid={errors.item ? true : undefined}
          aria-describedby={describedBy('item')}
          onChange={(event) => updateField('item', event.target.value)}
        />
        <FieldError id={errorId('item')} message={errors.item} />
      </div>

      <div className={styles.field}>
        <label htmlFor={fieldId('amount')} className={styles.label}>
          金額
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
          onChange={(event) => updateField('amount', event.target.value)}
        />
        <FieldError id={errorId('amount')} message={errors.amount} />
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
          onChange={(categoryId) => updateField('categoryId', categoryId)}
        />
        <FieldError id={errorId('categoryId')} message={errors.categoryId} />
      </div>

      <div className={styles.field}>
        <label htmlFor={fieldId('occurredOn')} className={styles.label}>
          日期
        </label>
        <input
          id={fieldId('occurredOn')}
          type="date"
          className={styles.input}
          value={values.occurredOn}
          aria-invalid={errors.occurredOn ? true : undefined}
          aria-describedby={describedBy('occurredOn')}
          onChange={(event) => updateField('occurredOn', event.target.value)}
        />
        <FieldError id={errorId('occurredOn')} message={errors.occurredOn} />
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
          onChange={(event) => updateField('note', event.target.value)}
        />
      </div>

      <button type="submit" className={styles.submit} disabled={isSaving}>
        {isSaving ? '儲存中…' : '儲存'}
      </button>
    </form>
  );
}

/**
 * 記帳表單頁：/new 為新增、/edit/:id 為編輯。
 * 編輯的預填來源為列表頁帶入的 router state；沒有 state（例如直接開網址）時顯示找不到。
 */
export function TransactionFormPage() {
  const { id } = useParams();
  const location = useLocation();
  const isEdit = id !== undefined;
  const editing = isEdit ? readEditRouteState(location.state, id) : undefined;
  const returnTo = readReturnTo(location.state);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BackLink to={returnTo} />
        <h1 className={styles.title}>{isEdit ? '編輯記帳' : '新增記帳'}</h1>
      </header>

      {isEdit && !editing ? (
        <ErrorBanner message="找不到要編輯的紀錄，請從列表重新選擇。" />
      ) : (
        <TransactionForm key={id ?? 'new'} editing={editing ?? undefined} returnTo={returnTo} />
      )}
    </main>
  );
}
