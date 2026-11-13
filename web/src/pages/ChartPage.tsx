import { Fragment, useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMonthlyReport } from '../api/reports';
import {
  ledgerSchema,
  type TCategoryShare,
  type TEntryType,
  type TLedger,
  type TMonthlyReport,
} from '../api/schemas';
import { BackLink } from '../components/BackLink';
import { CategoryDrilldown } from '../components/CategoryDrilldown';
import { ErrorBanner } from '../components/ErrorBanner';
import { LedgerToggle } from '../components/LedgerToggle';
import { LoadingStatus } from '../components/LoadingStatus';
import { MonthPicker } from '../components/MonthPicker';
import { ReportCharts } from '../components/ReportCharts';
import { isValidMonth, taipeiCurrentMonth } from '../lib/date';
import { formatAmount } from '../lib/format';
import styles from './ChartPage.module.css';

const DEFAULT_LEDGER: TLedger = 'personal';

/**
 * 解析網址參數；缺省或不合法時 month = 本月（Asia/Taipei）、ledger = personal，
 * 確保一律以合法值查詢（LINE 摘要連結或手動改網址都不會白畫面）。
 */
function resolveReportParams(searchParams: URLSearchParams): { month: string; ledger: TLedger } {
  const rawMonth = searchParams.get('month') ?? '';
  const parsedLedger = ledgerSchema.safeParse(searchParams.get('ledger'));
  return {
    month: isValidMonth(rawMonth) ? rawMonth : taipeiCurrentMonth(),
    ledger: parsedLedger.success ? parsedLedger.data : DEFAULT_LEDGER,
  };
}

type TReportSummaryProps = {
  report: TMonthlyReport;
};

/**
 * 月度合計：收入、支出、結餘（千分位、負數以「-」開頭）。
 */
function ReportSummary({ report }: TReportSummaryProps) {
  const items = [
    { label: '收入', amount: report.incomeTotal, className: styles.income },
    { label: '支出', amount: report.expenseTotal, className: styles.expense },
    { label: '結餘', amount: report.balance, className: styles.balance },
  ];
  return (
    <section aria-label="月度合計" className={styles.summary}>
      <ul className={styles.summaryList}>
        {items.map((item) => (
          <li key={item.label} className={styles.summaryItem}>
            <span className={styles.summaryLabel}>{item.label}</span>{' '}
            <span className={item.className}>{formatAmount(item.amount)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 已展開的分類（收支 + 分類鍵）；fromChart = 由圓餅圖點擊展開（需捲動到明細）。 */
type TSelectedCategory = {
  entryType: TEntryType;
  key: string;
  fromChart: boolean;
};

/** 分類鍵：優先 categoryId，舊版回應沒有時用名稱。 */
const shareKey = (share: TCategoryShare): string =>
  share.categoryId !== undefined ? `id:${share.categoryId}` : `name:${share.categoryName}`;

type TCategoryTableProps = {
  caption: string;
  emptyText: string;
  entryType: TEntryType;
  shares: readonly TCategoryShare[];
  month: string;
  ledger: TLedger;
  selected: TSelectedCategory | null;
  onToggle: (entryType: TEntryType, share: TCategoryShare) => void;
};

/**
 * 分類明細表（順序依 API：金額由大到小）；該收支無紀錄時顯示 emptyText。
 * 分類名稱為按鈕：點擊展開 / 收合該分類當月的每筆紀錄（同時只展開一個分類）。
 */
function CategoryTable({
  caption,
  emptyText,
  entryType,
  shares,
  month,
  ledger,
  selected,
  onToggle,
}: TCategoryTableProps) {
  const idPrefix = useId();
  if (shares.length === 0) {
    return <p className={styles.empty}>{emptyText}</p>;
  }
  return (
    <table className={styles.table}>
      <caption className={styles.tableCaption}>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">分類</th>
          <th scope="col" className={styles.numeric}>
            金額
          </th>
          <th scope="col" className={styles.numeric}>
            佔比
          </th>
        </tr>
      </thead>
      <tbody>
        {shares.map((category, index) => {
          const key = shareKey(category);
          const isOpen = selected?.entryType === entryType && selected.key === key;
          const detailId = `${idPrefix}-${index}`;
          return (
            <Fragment key={key}>
              <tr className={isOpen ? styles.openRow : undefined}>
                <td className={styles.categoryCell}>
                  <button
                    type="button"
                    className={styles.categoryButton}
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? detailId : undefined}
                    onClick={() => onToggle(entryType, category)}
                  >
                    <span aria-hidden="true" className={styles.chevron}>
                      {isOpen ? '▾' : '▸'}
                    </span>
                    {category.categoryName}
                  </button>
                </td>
                <td className={styles.numeric}>{formatAmount(category.amount)}</td>
                <td className={styles.numeric}>{`${category.ratio.toFixed(1)}%`}</td>
              </tr>
              {isOpen ? (
                <tr id={detailId} className={styles.detailRow}>
                  <td colSpan={3}>
                    <CategoryDrilldown
                      month={month}
                      ledger={ledger}
                      entryType={entryType}
                      share={category}
                      scrollIntoView={selected.fromChart}
                    />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * 統計圖表頁（/liff/chart?month=YYYY-MM&ledger=personal|company）。
 * 由網址參數決定查詢條件；切換月份或帳本時以 replace 更新網址，讓網址永遠對應畫面。
 */
export function ChartPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { month, ledger } = resolveReportParams(searchParams);
  const reportQuery = useMonthlyReport(month, ledger);
  const [selected, setSelected] = useState<TSelectedCategory | null>(null);

  const updateParams = (next: { month: string; ledger: TLedger }) => {
    setSelected(null);
    setSearchParams({ month: next.month, ledger: next.ledger }, { replace: true });
  };

  /** 表格點擊：同一分類再點一次收合。 */
  const toggleCategory = (entryType: TEntryType, share: TCategoryShare) => {
    const key = shareKey(share);
    setSelected((prev) =>
      prev?.entryType === entryType && prev.key === key
        ? null
        : { entryType, key, fromChart: false },
    );
  };
  /** 圓餅點擊：一律展開並捲動到明細。 */
  const selectFromChart = (entryType: TEntryType, share: TCategoryShare) => {
    setSelected({ entryType, key: shareKey(share), fromChart: true });
  };

  const renderContent = () => {
    if (reportQuery.isPending) return <LoadingStatus />;
    if (reportQuery.isError) return <ErrorBanner message={reportQuery.error.message} />;
    const report = reportQuery.data;
    return (
      <>
        <ReportSummary report={report} />
        <ReportCharts report={report} onSelectCategory={selectFromChart} />
        <div className={styles.tables}>
          <CategoryTable
            caption="支出分類明細"
            emptyText="本月無支出"
            entryType="expense"
            shares={report.expenseByCategory}
            month={month}
            ledger={ledger}
            selected={selected}
            onToggle={toggleCategory}
          />
          <CategoryTable
            caption="收入分類明細"
            emptyText="本月無收入"
            entryType="income"
            shares={report.incomeByCategory}
            month={month}
            ledger={ledger}
            selected={selected}
            onToggle={toggleCategory}
          />
        </div>
      </>
    );
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BackLink />
        <h1 className={styles.title}>統計圖表</h1>
        <Link
          to={{ pathname: '/annual', search: `?year=${month.slice(0, 4)}&ledger=${ledger}` }}
          className={styles.switchLink}
        >
          看 {month.slice(0, 4)} 年度報表 →
        </Link>
      </header>

      <section className={styles.filters}>
        <MonthPicker
          value={month}
          onChange={(nextMonth) => updateParams({ month: nextMonth, ledger })}
        />
        <LedgerToggle
          value={ledger}
          onChange={(nextLedger) => updateParams({ month, ledger: nextLedger })}
        />
      </section>

      {renderContent()}
    </main>
  );
}
