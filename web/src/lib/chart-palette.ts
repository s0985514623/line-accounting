/**
 * 圖表配色（SVG fill 需實際色碼，無法使用 CSS 變數）。
 * 類別色依固定順序指派、不循環；超過 8 類時其餘合併為「其餘」。
 * 色碼取自已通過色盲／對比驗證的 8 色類別調色盤（淺色模式；本 App 僅提供淺色）。
 */
export const CATEGORICAL_COLORS = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#6250d6',
  '#e34948',
] as const;

/** 收入／支出長條色，與全域 token --color-income / --color-expense 一致。 */
export const INCOME_COLOR = '#047857';
export const EXPENSE_COLOR = '#b91c1c';

/** 長條、圓餅之間的間隔色（卡片底色）。 */
export const CHART_SURFACE_COLOR = '#ffffff';
