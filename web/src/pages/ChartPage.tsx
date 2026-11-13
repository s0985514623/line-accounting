import { useSearchParams } from 'react-router';
import { useMonthlyReport } from '../api/reports';
import {
  ledgerSchema,
  type TCategoryShare,
  type TLedger,
  type TMonthlyReport,
} from '../api/schemas';
import { BackLink } from '../components/BackLink';
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

type TCategoryTableProps = {
  caption: string;
  emptyText: string;
  shares: readonly TCategoryShare[];
};

/**
 * 分類明細表（順序依 API：金額由大到小）；該收支無紀錄時顯示 emptyText。
 */
function CategoryTable({ caption, emptyText, shares }: TCategoryTableProps) {
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
        {shares.map((category, index) => (
          <tr key={`${index}-${category.categoryName}`}>
            <td className={styles.categoryCell}>{category.categoryName}</td>
            <td className={styles.numeric}>{formatAmount(category.amount)}</td>
            <td className={styles.numeric}>{`${category.ratio.toFixed(1)}%`}</td>
          </tr>
        ))}
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

  const updateParams = (next: { month: string; ledger: TLedger }) => {
    setSearchParams({ month: next.month, ledger: next.ledger }, { replace: true });
  };

  const renderContent = () => {
    if (reportQuery.isPending) return <LoadingStatus />;
    if (reportQuery.isError) return <ErrorBanner message={reportQuery.error.message} />;
    const report = reportQuery.data;
    return (
      <>
        <ReportSummary report={report} />
        <ReportCharts report={report} />
        <CategoryTable
          caption="支出分類明細"
          emptyText="本月無支出"
          shares={report.expenseByCategory}
        />
        <CategoryTable
          caption="收入分類明細"
          emptyText="本月無收入"
          shares={report.incomeByCategory}
        />
      </>
    );
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BackLink />
        <h1 className={styles.title}>統計圖表</h1>
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
