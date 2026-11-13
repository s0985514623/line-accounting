import { Fragment, useId, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAnnualReport } from '../api/reports';
import {
  ledgerSchema,
  type TAnnualCategoryShare,
  type TAnnualReport,
  type TEntryType,
  type TLedger,
} from '../api/schemas';
import { BackLink } from '../components/BackLink';
import { ErrorBanner } from '../components/ErrorBanner';
import { LedgerToggle } from '../components/LedgerToggle';
import { LoadingStatus } from '../components/LoadingStatus';
import { CategoryPies } from '../components/ReportCharts';
import { EXPENSE_COLOR, INCOME_COLOR } from '../lib/chart-palette';
import { taipeiCurrentMonth } from '../lib/date';
import { formatAmount } from '../lib/format';
import monthPickerStyles from '../components/MonthPicker.module.css';
import chartStyles from '../components/ReportCharts.module.css';
import annualStyles from './AnnualReportPage.module.css';
import styles from './ChartPage.module.css';

const DEFAULT_LEDGER: TLedger = 'personal';
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
/** 年份選單往前列出幾年。 */
const YEARS_BACK = 10;

function currentYear(): number {
  return Number(taipeiCurrentMonth().slice(0, 4));
}

/** 解析網址參數；缺省或不合法時 year = 今年（Asia/Taipei）、ledger = personal。 */
function resolveParams(searchParams: URLSearchParams): { year: number; ledger: TLedger } {
  const rawYear = searchParams.get('year') ?? '';
  const parsedYear = /^\d{4}$/.test(rawYear) ? Number(rawYear) : NaN;
  const parsedLedger = ledgerSchema.safeParse(searchParams.get('ledger'));
  return {
    year: parsedYear >= MIN_YEAR && parsedYear <= MAX_YEAR ? parsedYear : currentYear(),
    ledger: parsedLedger.success ? parsedLedger.data : DEFAULT_LEDGER,
  };
}

function YearPicker({ value, onChange }: { value: number; onChange: (year: number) => void }) {
  const id = useId();
  const latest = Math.max(currentYear(), value);
  const earliest = Math.min(latest - YEARS_BACK, value);
  const years = Array.from({ length: latest - earliest + 1 }, (_, index) => latest - index);
  return (
    <div className={monthPickerStyles.field}>
      <label htmlFor={id} className={monthPickerStyles.label}>
        年度
      </label>
      <select
        id={id}
        className={monthPickerStyles.input}
        value={String(value)}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {years.map((year) => (
          <option key={year} value={String(year)}>
            {year} 年
          </option>
        ))}
      </select>
    </div>
  );
}

function AnnualSummary({ report }: { report: TAnnualReport }) {
  const items = [
    { label: '收入', amount: report.incomeTotal, className: styles.income },
    { label: '支出', amount: report.expenseTotal, className: styles.expense },
    { label: '結餘', amount: report.balance, className: styles.balance },
  ];
  return (
    <section aria-label="年度合計" className={styles.summary}>
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

const formatTooltipValue = (value: unknown): string => formatAmount(Number(value));

/** 12 個月收支長條圖（視覺輔助，aria-hidden；點長條跳到該月報表）。 */
function MonthlyTrendChart({
  report,
  onSelectMonth,
}: {
  report: TAnnualReport;
  onSelectMonth: (month: string) => void;
}) {
  const data = report.months.map((month) => ({
    month: month.month,
    name: `${Number(month.month.slice(5))}月`,
    income: month.incomeTotal,
    expense: month.expenseTotal,
  }));
  const handleClick = (entry: unknown) => {
    const month = (entry as { payload?: { month?: string } } | undefined)?.payload?.month;
    if (month) onSelectMonth(month);
  };
  return (
    <figure className={chartStyles.card}>
      <figcaption className={chartStyles.caption}>每月收入與支出（點長條看該月）</figcaption>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} accessibilityLayer={false} barGap={1}>
          <CartesianGrid vertical={false} stroke="#e5e7eb" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} fontSize={11} />
          <YAxis
            width={56}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tickFormatter={(value: number) => formatAmount(value)}
          />
          <Tooltip formatter={formatTooltipValue} cursor={{ fill: '#f3f4f6' }} />
          <Legend />
          <Bar
            dataKey="income"
            name="收入"
            fill={INCOME_COLOR}
            radius={[3, 3, 0, 0]}
            cursor="pointer"
            onClick={handleClick}
          />
          <Bar
            dataKey="expense"
            name="支出"
            fill={EXPENSE_COLOR}
            radius={[3, 3, 0, 0]}
            cursor="pointer"
            onClick={handleClick}
          />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

/** 每月明細表（文字版，月份可點進月報）。 */
function MonthTable({ report, ledger }: { report: TAnnualReport; ledger: TLedger }) {
  return (
    <table className={styles.table}>
      <caption className={styles.tableCaption}>每月明細</caption>
      <thead>
        <tr>
          <th scope="col">月份</th>
          <th scope="col" className={styles.numeric}>
            收入
          </th>
          <th scope="col" className={styles.numeric}>
            支出
          </th>
          <th scope="col" className={styles.numeric}>
            結餘
          </th>
        </tr>
      </thead>
      <tbody>
        {report.months.map((month) => (
          <tr key={month.month}>
            <td>
              <Link to={{ pathname: '/chart', search: `?month=${month.month}&ledger=${ledger}` }}>
                {Number(month.month.slice(5))} 月
              </Link>
            </td>
            <td className={styles.numeric}>{formatAmount(month.incomeTotal)}</td>
            <td className={styles.numeric}>{formatAmount(month.expenseTotal)}</td>
            <td className={styles.numeric}>{formatAmount(month.balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 分類鍵：優先 categoryId，沒有時用名稱。 */
const shareKey = (share: TAnnualCategoryShare): string =>
  share.categoryId !== undefined ? `id:${share.categoryId}` : `name:${share.categoryName}`;

/** 該分類 1–12 月金額；有金額的月份可點進該月統計並展開此分類細項。 */
function CategoryMonths({
  share,
  entryType,
  year,
  ledger,
}: {
  share: TAnnualCategoryShare;
  entryType: TEntryType;
  year: number;
  ledger: TLedger;
}) {
  return (
    <ul className={annualStyles.monthList} aria-label={`${share.categoryName}每月金額`}>
      {share.monthlyAmounts.map((amount, index) => {
        const month = `${year}-${String(index + 1).padStart(2, '0')}`;
        const label = `${index + 1} 月`;
        const params = new URLSearchParams({ month, ledger, type: entryType });
        if (share.categoryId !== undefined) params.set('category', String(share.categoryId));
        return (
          <li key={month}>
            {amount > 0 ? (
              <Link
                to={{ pathname: '/chart', search: `?${params}` }}
                className={annualStyles.monthLink}
              >
                <span>{label}</span>
                <span className={annualStyles.monthAmount}>{formatAmount(amount)}</span>
              </Link>
            ) : (
              <span className={`${annualStyles.monthLink} ${annualStyles.monthEmpty}`}>
                <span>{label}</span>
                <span className={annualStyles.monthAmount}>—</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** 分類明細表：分類名稱為按鈕，點擊展開 / 收合該分類 1–12 月金額（同時只展開一個）。 */
function CategoryTable({
  caption,
  emptyText,
  entryType,
  shares,
  year,
  ledger,
}: {
  caption: string;
  emptyText: string;
  entryType: TEntryType;
  shares: readonly TAnnualCategoryShare[];
  year: number;
  ledger: TLedger;
}) {
  const idPrefix = useId();
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (shares.length === 0) return <p className={styles.empty}>{emptyText}</p>;
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
        {shares.map((share, index) => {
          const key = shareKey(share);
          const isOpen = openKey === key;
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
                    onClick={() => setOpenKey(isOpen ? null : key)}
                  >
                    <span aria-hidden="true" className={styles.chevron}>
                      {isOpen ? '▾' : '▸'}
                    </span>
                    {share.categoryName}
                  </button>
                </td>
                <td className={styles.numeric}>{formatAmount(share.amount)}</td>
                <td className={styles.numeric}>{`${share.ratio.toFixed(1)}%`}</td>
              </tr>
              {isOpen ? (
                <tr id={detailId} className={styles.detailRow}>
                  <td colSpan={3}>
                    <CategoryMonths
                      share={share}
                      entryType={entryType}
                      year={year}
                      ledger={ledger}
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
 * 年度報表頁（/liff/annual?year=YYYY&ledger=personal|company）：
 * 全年收入 / 支出 / 結餘、12 個月趨勢（點月份進月報）、支出與收入分類佔比。
 */
export function AnnualReportPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { year, ledger } = resolveParams(searchParams);
  const reportQuery = useAnnualReport(year, ledger);

  const updateParams = (next: { year: number; ledger: TLedger }) => {
    setSearchParams({ year: String(next.year), ledger: next.ledger }, { replace: true });
  };

  const goToMonth = (month: string) => {
    navigate({ pathname: '/chart', search: `?month=${month}&ledger=${ledger}` });
  };

  const renderContent = () => {
    if (reportQuery.isPending) return <LoadingStatus />;
    if (reportQuery.isError) return <ErrorBanner message={reportQuery.error.message} />;
    const report = reportQuery.data;
    return (
      <>
        <AnnualSummary report={report} />
        <div className={chartStyles.charts} aria-hidden="true">
          <MonthlyTrendChart report={report} onSelectMonth={goToMonth} />
          <CategoryPies report={report} />
        </div>
        <div className={styles.tables}>
          <MonthTable report={report} ledger={ledger} />
          <CategoryTable
            caption="支出分類明細"
            emptyText="今年無支出"
            entryType="expense"
            shares={report.expenseByCategory}
            year={year}
            ledger={ledger}
          />
          <CategoryTable
            caption="收入分類明細"
            emptyText="今年無收入"
            entryType="income"
            shares={report.incomeByCategory}
            year={year}
            ledger={ledger}
          />
        </div>
      </>
    );
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BackLink />
        <h1 className={styles.title}>年度報表</h1>
      </header>

      <section className={styles.filters}>
        <YearPicker
          value={year}
          onChange={(nextYear) => updateParams({ year: nextYear, ledger })}
        />
        <LedgerToggle
          value={ledger}
          onChange={(nextLedger) => updateParams({ year, ledger: nextLedger })}
        />
      </section>

      {renderContent()}
    </main>
  );
}
