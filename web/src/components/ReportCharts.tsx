import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  TCategoryShare,
  TEntryType,
  TExpenseByCategory,
  TMonthlyReport,
} from '../api/schemas';
import {
  CATEGORICAL_COLORS,
  CHART_SURFACE_COLOR,
  EXPENSE_COLOR,
  INCOME_COLOR,
} from '../lib/chart-palette';
import { formatAmount } from '../lib/format';
import styles from './ReportCharts.module.css';

/** 超過類別色數量時，其餘分類合併的名稱。 */
const REST_SLICE_NAME = '其餘分類';
const CHART_HEIGHT = 220;

type TPieSlice = {
  name: string;
  amount: number;
  fill: string;
  /** 對應的分類；合併的「其餘分類」為 null（不可點擊展開） */
  share: TCategoryShare | null;
};

/** 取第 index 個類別色（index 由呼叫端保證在範圍內）。 */
const colorAt = (index: number): string => CATEGORICAL_COLORS[index] ?? CATEGORICAL_COLORS[0];

/**
 * 依 API 順序（金額由大到小）指派固定順序的類別色；超過 8 類時第 8 片起合併為「其餘分類」。
 */
function toPieSlices(categories: readonly TExpenseByCategory[]): TPieSlice[] {
  const maxSlices = CATEGORICAL_COLORS.length;
  const needsFold = categories.length > maxSlices;
  const head = needsFold ? categories.slice(0, maxSlices - 1) : categories;
  const slices: TPieSlice[] = head.map((category, index) => ({
    name: category.categoryName,
    amount: category.amount,
    fill: colorAt(index),
    share: category,
  }));
  if (!needsFold) return slices;
  const restAmount = categories
    .slice(maxSlices - 1)
    .reduce((sum, category) => sum + category.amount, 0);
  return [
    ...slices,
    { name: REST_SLICE_NAME, amount: restAmount, fill: colorAt(maxSlices - 1), share: null },
  ];
}

const formatTooltipValue = (value: unknown): string => formatAmount(Number(value));

type TReportChartsProps = {
  report: TMonthlyReport;
  /** 點擊圓餅扇形（「其餘分類」除外）時呼叫 */
  onSelectCategory?: (entryType: TEntryType, share: TCategoryShare) => void;
};

/**
 * 月度統計圖表：收支長條圖 + 支出 / 收入分類圓餅圖（該收支無紀錄時不畫該圓餅）。
 * 圖表僅為視覺輔助，所有數值另以合計區與明細表的文字呈現，因此對輔助科技隱藏（aria-hidden）。
 * 點擊扇形可展開該分類的細項（鍵盤 / 輔助科技使用者改用明細表的分類按鈕）。
 */
export function ReportCharts({ report, onSelectCategory }: TReportChartsProps) {
  const barData = [
    { name: report.month, income: report.incomeTotal, expense: report.expenseTotal },
  ];
  return (
    <div className={styles.charts} aria-hidden="true">
      <figure className={styles.card}>
        <figcaption className={styles.caption}>收入與支出</figcaption>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={barData} accessibilityLayer={false} barGap={2}>
            <CartesianGrid vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey="name" tickLine={false} axisLine={false} />
            <YAxis
              width={64}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => formatAmount(value)}
            />
            <Tooltip formatter={formatTooltipValue} cursor={{ fill: '#f3f4f6' }} />
            <Legend />
            <Bar
              dataKey="income"
              name="收入"
              fill={INCOME_COLOR}
              radius={[4, 4, 0, 0]}
              maxBarSize={48}
            />
            <Bar
              dataKey="expense"
              name="支出"
              fill={EXPENSE_COLOR}
              radius={[4, 4, 0, 0]}
              maxBarSize={48}
            />
          </BarChart>
        </ResponsiveContainer>
      </figure>

      <CategoryPies report={report} onSelectCategory={onSelectCategory} />
    </div>
  );
}

type TCategoryPiesProps = {
  report: Pick<TMonthlyReport, 'expenseByCategory' | 'incomeByCategory'>;
  onSelectCategory?: (entryType: TEntryType, share: TCategoryShare) => void;
};

/**
 * 支出 / 收入分類圓餅圖（該收支無紀錄時不畫該圓餅）。月報與年報共用；
 * 外層容器需自行 aria-hidden（數值另有文字表格）。
 */
export function CategoryPies({ report, onSelectCategory }: TCategoryPiesProps) {
  const pies = [
    {
      caption: '支出分類佔比',
      entryType: 'expense' as const,
      slices: toPieSlices(report.expenseByCategory),
    },
    {
      caption: '收入分類佔比',
      entryType: 'income' as const,
      slices: toPieSlices(report.incomeByCategory),
    },
  ].filter((pie) => pie.slices.length > 0);

  return (
    <>
      {pies.map(({ caption, entryType, slices }) => (
        <figure key={caption} className={styles.card}>
          <figcaption className={styles.caption}>{caption}</figcaption>
          <ResponsiveContainer width="100%" height={CHART_HEIGHT + 40}>
            <PieChart accessibilityLayer={false}>
              <Pie
                data={slices}
                dataKey="amount"
                nameKey="name"
                innerRadius="50%"
                outerRadius="80%"
                stroke={CHART_SURFACE_COLOR}
                strokeWidth={2}
                isAnimationActive={false}
                className={onSelectCategory ? styles.clickablePie : undefined}
                onClick={(_data: unknown, index: number) => {
                  const share = slices[index]?.share;
                  if (share && onSelectCategory) onSelectCategory(entryType, share);
                }}
              />
              <Tooltip formatter={formatTooltipValue} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </figure>
      ))}
    </>
  );
}
