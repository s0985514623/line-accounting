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
import type { TExpenseByCategory, TMonthlyReport } from '../api/schemas';
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
  const slices = head.map((category, index) => ({
    name: category.categoryName,
    amount: category.amount,
    fill: colorAt(index),
  }));
  if (!needsFold) return slices;
  const restAmount = categories
    .slice(maxSlices - 1)
    .reduce((sum, category) => sum + category.amount, 0);
  return [...slices, { name: REST_SLICE_NAME, amount: restAmount, fill: colorAt(maxSlices - 1) }];
}

const formatTooltipValue = (value: unknown): string => formatAmount(Number(value));

type TReportChartsProps = {
  report: TMonthlyReport;
};

/**
 * 月度統計圖表：收支長條圖 + 支出分類圓餅圖（無支出時不畫圓餅）。
 * 圖表僅為視覺輔助，所有數值另以合計區與明細表的文字呈現，因此對輔助科技隱藏（aria-hidden）。
 */
export function ReportCharts({ report }: TReportChartsProps) {
  const barData = [
    { name: report.month, income: report.incomeTotal, expense: report.expenseTotal },
  ];
  const pieSlices = toPieSlices(report.expenseByCategory);

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

      {pieSlices.length > 0 ? (
        <figure className={styles.card}>
          <figcaption className={styles.caption}>支出分類佔比</figcaption>
          <ResponsiveContainer width="100%" height={CHART_HEIGHT + 40}>
            <PieChart accessibilityLayer={false}>
              <Pie
                data={pieSlices}
                dataKey="amount"
                nameKey="name"
                innerRadius="50%"
                outerRadius="80%"
                stroke={CHART_SURFACE_COLOR}
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Tooltip formatter={formatTooltipValue} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </figure>
      ) : null}
    </div>
  );
}
