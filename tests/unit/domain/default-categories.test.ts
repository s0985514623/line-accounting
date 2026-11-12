/**
 * 單元測試：預設分類資料（19 筆，個人 10 + 公司 9）
 *
 * 執行：npx vitest run tests/unit/domain/default-categories.test.ts    （或 npm run test:unit）
 *
 * 契約（nodejs-master 請遵循）：
 *   src/domain/default-categories.ts
 *     export interface DefaultCategory { ledger: Ledger; entryType: EntryType; name: string; isFallback: boolean }
 *     export const DEFAULT_CATEGORIES: readonly DefaultCategory[]
 * 依據：specs/features/access/加入好友.feature（19 個預設分類）、erm.dbml（每組 ledger×entry_type 有一個 fallback）。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../../../src/domain/default-categories';

const key = (c: { ledger: string; entryType: string }) => `${c.ledger}/${c.entryType}`;

function names(ledger: string, entryType: string): string[] {
  return DEFAULT_CATEGORIES.filter((c) => c.ledger === ledger && c.entryType === entryType).map(
    (c) => c.name,
  );
}

describe('[Smoke] DEFAULT_CATEGORIES', () => {
  it('共 19 筆', () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(19);
  });
});

describe('[Happy] 內容與規格一致', () => {
  it('個人支出：餐飲、交通、購物、居住、娛樂、醫療、其他', () => {
    expect(names('personal', 'expense')).toEqual([
      '餐飲',
      '交通',
      '購物',
      '居住',
      '娛樂',
      '醫療',
      '其他',
    ]);
  });
  it('個人收入：薪資、獎金、其他', () => {
    expect(names('personal', 'income')).toEqual(['薪資', '獎金', '其他']);
  });
  it('公司支出：進貨、薪資、租金、水電、交通、文具、其他', () => {
    expect(names('company', 'expense')).toEqual([
      '進貨',
      '薪資',
      '租金',
      '水電',
      '交通',
      '文具',
      '其他',
    ]);
  });
  it('公司收入：營業收入、其他', () => {
    expect(names('company', 'income')).toEqual(['營業收入', '其他']);
  });
});

describe('[Edge] fallback 不變量', () => {
  it('每組 帳本×收支 恰好一個 fallback，且名稱為「其他」', () => {
    const groups = new Map<string, Array<(typeof DEFAULT_CATEGORIES)[number]>>();
    for (const c of DEFAULT_CATEGORIES) {
      groups.set(key(c), [...(groups.get(key(c)) ?? []), c]);
    }
    expect([...groups.keys()].sort()).toEqual([
      'company/expense',
      'company/income',
      'personal/expense',
      'personal/income',
    ]);
    for (const [group, items] of groups) {
      const fallbacks = items.filter((c) => c.isFallback);
      expect(fallbacks, group).toHaveLength(1);
      expect(fallbacks[0]?.name, group).toBe('其他');
    }
  });

  it('同一組 帳本×收支 內名稱不重複（不違反唯一約束）', () => {
    const seen = new Set<string>();
    for (const c of DEFAULT_CATEGORIES) {
      const k = `${key(c)}/${c.name}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
  });

  it('名稱皆非空且無前後空白', () => {
    for (const c of DEFAULT_CATEGORIES) {
      expect(c.name).toBe(c.name.trim());
      expect(c.name.length).toBeGreaterThan(0);
    }
  });
});
