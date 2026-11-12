/** 數字格式工具。 */

const amountFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** 以千分位格式化金額（例如 99999999 → 99,999,999）。 */
export function formatAmount(amount: number): string {
  return amountFormatter.format(amount);
}
