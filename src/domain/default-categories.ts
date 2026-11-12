/**
 * 預設分類（19 筆：個人 10 + 公司 9）。純資料，無 I/O。
 * 順序同 specs/features/access/加入好友.feature（個人支出 → 個人收入 → 公司支出 → 公司收入），
 * onboarding 以此順序 createMany，故分類 id 亦依此順序遞增。
 * 每組 帳本×收支 恰一個 isFallback（名稱「其他」），對應 DB partial unique index categories_one_fallback。
 */
import type { EntryType, Ledger } from './enums';

export interface DefaultCategory {
  ledger: Ledger;
  entryType: EntryType;
  name: string;
  isFallback: boolean;
}

export const FALLBACK_CATEGORY_NAME = '其他';

function group(
  ledger: Ledger,
  entryType: EntryType,
  regularNames: readonly string[],
): DefaultCategory[] {
  return [
    ...regularNames.map((name) => ({ ledger, entryType, name, isFallback: false })),
    { ledger, entryType, name: FALLBACK_CATEGORY_NAME, isFallback: true },
  ];
}

export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = Object.freeze([
  ...group('personal', 'expense', ['餐飲', '交通', '購物', '居住', '娛樂', '醫療']),
  ...group('personal', 'income', ['薪資', '獎金']),
  ...group('company', 'expense', ['進貨', '薪資', '租金', '水電', '交通', '文具']),
  ...group('company', 'income', ['營業收入']),
]);
