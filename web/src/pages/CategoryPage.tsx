import { useId, useRef, useState, type FormEvent } from 'react';
import { useCategories, useCreateCategory, useDeleteCategory } from '../api/categories';
import type { TCategory, TEntryType, TLedger } from '../api/schemas';
import { BackLink } from '../components/BackLink';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EntryTypeToggle } from '../components/EntryTypeToggle';
import { ErrorBanner } from '../components/ErrorBanner';
import { LedgerToggle } from '../components/LedgerToggle';
import { LoadingStatus } from '../components/LoadingStatus';
import styles from './CategoryPage.module.css';

/** 分類名稱上限（api.yml CategoryInput.name maxLength）。 */
const CATEGORY_NAME_MAX_LENGTH = 50;
const NAME_REQUIRED_MESSAGE = '請輸入分類名稱';

type TCategoryRowProps = {
  category: TCategory;
  onDelete: (category: TCategory) => void;
};

/**
 * 分類列表中的單列；「其他」（isFallback）不渲染刪除鈕。
 */
function CategoryRow({ category, onDelete }: TCategoryRowProps) {
  return (
    <li className={styles.row}>
      <span className={styles.name}>{category.name}</span>
      {category.isFallback ? (
        <span className={styles.fallbackTag}>不可刪除</span>
      ) : (
        <button
          type="button"
          className={styles.deleteButton}
          aria-label={`刪除${category.name}`}
          onClick={() => onDelete(category)}
        >
          刪除
        </button>
      )}
    </li>
  );
}

/**
 * 分類管理頁（/liff/categories）：帳本 × 收支切換、分類列表、新增與刪除。
 * 列表順序依 API 回傳（一般分類在前、「其他」在後），前端不重排。
 * 新增與刪除皆以 ref 擋住連點（第二次點擊可能早於 isPending 的重新渲染）。
 */
export function CategoryPage() {
  const inputId = useId();
  const errorId = `${inputId}-error`;

  const [ledger, setLedger] = useState<TLedger>('personal');
  const [entryType, setEntryType] = useState<TEntryType>('expense');
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TCategory | null>(null);
  const isCreatingRef = useRef(false);
  const isDeletingRef = useRef(false);

  const categoriesQuery = useCategories(ledger, entryType);
  const createMutation = useCreateCategory();
  const deleteMutation = useDeleteCategory();

  /** 開始新動作前清掉前一個動作的錯誤，畫面上同時只留一則錯誤提示。 */
  const clearFeedback = () => {
    setNameError(null);
    createMutation.reset();
    deleteMutation.reset();
  };

  const changeLedger = (next: TLedger) => {
    clearFeedback();
    setLedger(next);
  };

  const changeEntryType = (next: TEntryType) => {
    clearFeedback();
    setEntryType(next);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isCreatingRef.current) return;
    clearFeedback();

    // String#trim 會一併移除全形空白（U+3000）
    const trimmedName = name.trim();
    if (trimmedName === '') {
      setNameError(NAME_REQUIRED_MESSAGE);
      return;
    }

    isCreatingRef.current = true;
    createMutation.mutate(
      { ledger, entryType, name: trimmedName },
      {
        onSuccess: () => setName(''),
        onSettled: () => {
          isCreatingRef.current = false;
        },
      },
    );
  };

  const handleRequestDelete = (category: TCategory) => {
    clearFeedback();
    setPendingDelete(category);
  };

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

  const renderList = () => {
    if (categoriesQuery.isPending) return <LoadingStatus />;
    if (categoriesQuery.isError) return <ErrorBanner message={categoriesQuery.error.message} />;
    return (
      <>
        <ul className={styles.list}>
          {categoriesQuery.data.map((category) => (
            <CategoryRow key={category.id} category={category} onDelete={handleRequestDelete} />
          ))}
        </ul>
        <p className={styles.hint}>
          「其他」為預設分類，無法刪除；刪除分類後，原本的紀錄會自動改歸「其他」。
        </p>
      </>
    );
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BackLink />
        <h1 className={styles.title}>分類管理</h1>
      </header>

      <section className={styles.filters}>
        <LedgerToggle value={ledger} onChange={changeLedger} />
        <EntryTypeToggle value={entryType} onChange={changeEntryType} />
      </section>

      <form className={styles.form} noValidate onSubmit={handleSubmit}>
        <label htmlFor={inputId} className={styles.label}>
          分類名稱
        </label>
        <div className={styles.inputRow}>
          <input
            id={inputId}
            type="text"
            className={styles.input}
            autoComplete="off"
            maxLength={CATEGORY_NAME_MAX_LENGTH}
            value={name}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? errorId : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setNameError(null);
            }}
          />
          <button type="submit" className={styles.submit} disabled={createMutation.isPending}>
            新增分類
          </button>
        </div>
        {nameError ? (
          <div id={errorId}>
            <ErrorBanner message={nameError} />
          </div>
        ) : null}
        {createMutation.isError ? <ErrorBanner message={createMutation.error.message} /> : null}
      </form>

      {deleteMutation.isError ? <ErrorBanner message={deleteMutation.error.message} /> : null}

      {renderList()}

      {pendingDelete ? (
        <ConfirmDialog
          title="刪除分類"
          confirmLabel="確認刪除"
          isBusy={deleteMutation.isPending}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        >
          <p className={styles.dialogText}>
            {`確定要刪除「${pendingDelete.name}」嗎？此分類底下的紀錄將改歸「其他」。`}
          </p>
        </ConfirmDialog>
      ) : null}
    </main>
  );
}
