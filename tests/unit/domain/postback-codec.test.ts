/**
 * 單元測試：postback data 編碼 / 解碼（純函式）
 *
 * 執行：npx vitest run tests/unit/domain/postback-codec.test.ts
 *
 * 契約（nodejs-master 請遵循）——src/domain/postback-codec.ts：
 *   export const POSTBACK_DATA_MAX_LENGTH = 300;                 // ASM-05（以字串 .length 計，不是 URL 編碼後位元組）
 *   export function isPostbackDataWithinLimit(data: string): boolean;   // data.length <= 300
 *   export interface PickPayload {
 *     token: string; ledger: Ledger; entryType: EntryType; item: string;
 *     amount: number; date: string （YYYY-MM-DD）; note: string | null; categoryId: number;
 *   }
 *   export type PostbackPayload = ({ action: 'pick' } & PickPayload) | { action: 'delete'; id: number };
 *   export function encodePick(payload: PickPayload): string;    // 永不拋出；超長由呼叫端以 isPostbackDataWithinLimit 判斷
 *   export function encodeDelete(id: number): string;
 *   export function decodePostback(data: string): PostbackPayload | null;   // 不合法一律回 null（呼叫端回「資料格式錯誤，請重新記帳」，ASM-07）
 *
 * 編碼規則（implementation-plan R4）：只跳脫 % & = +（→ %25 %26 %3D %2B），中文與空白保留原字；
 *   pick 欄位順序固定：action, token, ledger, type, item, amount, date, note, categoryId（與規格 postback 範例逐字一致）；
 *   note 為 null 編成 `note=`，解碼回 null。
 * delete 格式：action=delete&id=<id>（P4 另會加 delete_confirm / delete_cancel，本檔不測）。
 */
import { describe, expect, it } from 'vitest';
import {
  POSTBACK_DATA_MAX_LENGTH,
  decodePostback,
  encodeDelete,
  encodePick,
  isPostbackDataWithinLimit,
} from '../../../src/domain/postback-codec';

const basePick = {
  token: 'tk1',
  ledger: 'personal',
  entryType: 'expense',
  item: '早餐',
  amount: 80,
  date: '2026-11-12',
  note: '便利商店',
  categoryId: 1,
} as const;

describe('[Smoke] 規格範例（選擇分類完成記帳.feature）逐字一致', () => {
  it('encodePick：有備註', () => {
    expect(encodePick(basePick)).toBe(
      'action=pick&token=tk1&ledger=personal&type=expense&item=早餐&amount=80&date=2026-11-12&note=便利商店&categoryId=1',
    );
  });

  it('encodePick：無備註 → note= 為空', () => {
    expect(encodePick({ ...basePick, note: null })).toBe(
      'action=pick&token=tk1&ledger=personal&type=expense&item=早餐&amount=80&date=2026-11-12&note=&categoryId=1',
    );
  });

  it('decodePostback：規格範例字串', () => {
    expect(
      decodePostback(
        'action=pick&token=tk1&ledger=personal&type=expense&item=早餐&amount=80&date=2026-11-12&note=便利商店&categoryId=1',
      ),
    ).toEqual({ action: 'pick', ...basePick });
  });

  it('encodeDelete / decode delete', () => {
    expect(encodeDelete(10)).toBe('action=delete&id=10');
    expect(decodePostback('action=delete&id=10')).toEqual({ action: 'delete', id: 10 });
  });
});

describe('[Happy] 往返（encode → decode）', () => {
  it('公司收入、大金額、無備註', () => {
    const payload = {
      token: 'Ab3_-xYz0987',
      ledger: 'company',
      entryType: 'income',
      item: '營業收入',
      amount: 99999999,
      date: '2026-01-31',
      note: null,
      categoryId: 8,
    } as const;
    expect(decodePostback(encodePick(payload))).toEqual({ action: 'pick', ...payload });
  });

  it('多位數 categoryId 與 id', () => {
    expect(decodePostback(encodePick({ ...basePick, categoryId: 123 }))).toMatchObject({
      categoryId: 123,
    });
    expect(decodePostback(encodeDelete(98765))).toEqual({ action: 'delete', id: 98765 });
  });

  it('decode 後 amount 與 categoryId 為 number', () => {
    const decoded = decodePostback(encodePick(basePick));
    expect(decoded).not.toBeNull();
    if (decoded?.action !== 'pick') throw new Error('應為 pick');
    expect(typeof decoded.amount).toBe('number');
    expect(typeof decoded.categoryId).toBe('number');
  });
});

describe('[Edge] 特殊字元：只跳脫 % & = +', () => {
  it('備註含 & = + % 的往返不失真', () => {
    const note = 'a&b=c+d%e';
    const data = encodePick({ ...basePick, note });
    expect(data).toContain('note=a%26b%3Dc%2Bd%25e&categoryId=1');
    expect(decodePostback(data)).toMatchObject({ action: 'pick', note });
  });

  it('備註為看似已編碼的字串（%41、%E4）時，不得被二次解碼', () => {
    const note = '%41%E4%B8%AD';
    const data = encodePick({ ...basePick, note });
    expect(data).toContain('note=%2541%25E4%25B8%25AD');
    expect(decodePostback(data)).toMatchObject({ note });
  });

  it('備註只有「+」或「&」', () => {
    expect(decodePostback(encodePick({ ...basePick, note: '+' }))).toMatchObject({ note: '+' });
    expect(decodePostback(encodePick({ ...basePick, note: '&' }))).toMatchObject({ note: '&' });
    expect(encodePick({ ...basePick, note: '+' })).toContain('note=%2B&');
  });

  it('備註注入 `&categoryId=5`、`&action=delete` 不會改變解碼結果（&、= 已跳脫）', () => {
    const note = 'x&categoryId=5&action=delete&id=1';
    const decoded = decodePostback(encodePick({ ...basePick, note }));
    expect(decoded).toEqual({ action: 'pick', ...basePick, note });
  });

  it('項目含 & = + % 也往返不失真', () => {
    const item = 'A&B=C+D%';
    expect(decodePostback(encodePick({ ...basePick, item }))).toMatchObject({ item });
  });

  it('中文、Emoji 與空白保留原字（不做百分比編碼）', () => {
    const data = encodePick({ ...basePick, item: '宵夜🍜', note: '和同事 聚餐' });
    expect(data).toContain('item=宵夜🍜');
    expect(data).toContain('note=和同事 聚餐');
    expect(data).not.toMatch(/%E[0-9A-F]/);
    expect(decodePostback(data)).toMatchObject({ item: '宵夜🍜', note: '和同事 聚餐' });
  });

  it('備註含 XSS / SQL 字串往返不失真', () => {
    const note = "'); DROP TABLE transactions;-- <script>alert(1)</script>";
    expect(decodePostback(encodePick({ ...basePick, note }))).toMatchObject({ note });
  });
});

describe('[Edge] 300 字元上限（ASM-05）', () => {
  /** 產生讓整串 data 剛好為 targetLength 的 pick data（以 ASCII 備註補足，避免跳脫干擾）。 */
  function pickDataOfLength(targetLength: number): string {
    const base = encodePick({ ...basePick, note: '' }).length;
    const padding = targetLength - base;
    if (padding < 0) throw new Error('測試資料基底已超過目標長度');
    return encodePick({ ...basePick, note: 'a'.repeat(padding) });
  }

  it('常數為 300', () => {
    expect(POSTBACK_DATA_MAX_LENGTH).toBe(300);
  });

  it('剛好 300 字元 → 在上限內', () => {
    const data = pickDataOfLength(300);
    expect(data.length).toBe(300);
    expect(isPostbackDataWithinLimit(data)).toBe(true);
  });

  it('301 字元 → 超過上限', () => {
    const data = pickDataOfLength(301);
    expect(data.length).toBe(301);
    expect(isPostbackDataWithinLimit(data)).toBe(false);
  });

  it('299 與 0 字元 → 在上限內', () => {
    expect(isPostbackDataWithinLimit(pickDataOfLength(299))).toBe(true);
    expect(isPostbackDataWithinLimit('')).toBe(true);
  });

  it('超過上限時 encodePick 仍回傳完整字串、不拋出（由呼叫端判斷）', () => {
    const data = encodePick({ ...basePick, note: 'a'.repeat(1000) });
    expect(data.length).toBeGreaterThan(1000);
    expect(isPostbackDataWithinLimit(data)).toBe(false);
  });

  it('長度以字元數計：150 個中文備註不因 URL 編碼而爆量（URL 編碼會達 1350+ 字元）', () => {
    const data = encodePick({ ...basePick, note: '備'.repeat(150) });
    expect(data.length).toBeLessThan(300);
    expect(isPostbackDataWithinLimit(data)).toBe(true);
  });

  it('跳脫後會變長：備註全為 & 時，長度以跳脫後（每個 3 字元）計算', () => {
    const plain = encodePick({ ...basePick, note: '' }).length;
    const data = encodePick({ ...basePick, note: '&'.repeat(10) });
    expect(data.length).toBe(plain + 30);
  });
});

describe('[Error] decodePostback 不合法一律回 null（ASM-07）', () => {
  const valid = encodePick(basePick);

  it.each([
    ['空字串', ''],
    ['非 postback 字串', 'hello'],
    ['未知 action', 'action=foo&id=1'],
    ['缺 action', 'token=tk1&ledger=personal'],
  ])('%s', (_name, data) => {
    expect(decodePostback(data)).toBeNull();
  });

  it.each([
    ['缺 token', valid.replace('token=tk1&', '')],
    ['缺 ledger', valid.replace('ledger=personal&', '')],
    ['缺 type', valid.replace('type=expense&', '')],
    ['缺 item', valid.replace('item=早餐&', '')],
    ['缺 amount', valid.replace('amount=80&', '')],
    ['缺 date', valid.replace('date=2026-11-12&', '')],
    ['缺 categoryId', valid.replace('&categoryId=1', '')],
  ])('pick %s', (_name, data) => {
    expect(data).not.toBe(valid);
    expect(decodePostback(data)).toBeNull();
  });

  it.each([
    ['token 為空', valid.replace('token=tk1', 'token=')],
    ['ledger 非列舉值', valid.replace('ledger=personal', 'ledger=other')],
    ['ledger 為中文', valid.replace('ledger=personal', 'ledger=個人')],
    ['type 非列舉值', valid.replace('type=expense', 'type=transfer')],
    ['amount 非數字', valid.replace('amount=80', 'amount=abc')],
    ['amount 為小數', valid.replace('amount=80', 'amount=12.5')],
    ['amount 為 0', valid.replace('amount=80', 'amount=0')],
    ['amount 為負數', valid.replace('amount=80', 'amount=-5')],
    ['amount 為空', valid.replace('amount=80', 'amount=')],
    ['date 不存在的日期', valid.replace('date=2026-11-12', 'date=2026-02-30')],
    ['date 月份超出', valid.replace('date=2026-11-12', 'date=2026-13-01')],
    ['date 格式錯（無分隔）', valid.replace('date=2026-11-12', 'date=20261112')],
    ['date 尾端多餘字元', valid.replace('date=2026-11-12', 'date=2026-11-12x')],
    ['categoryId 非數字', valid.replace('categoryId=1', 'categoryId=x')],
    ['categoryId 為 0', valid.replace('categoryId=1', 'categoryId=0')],
    ['categoryId 為負數', valid.replace('categoryId=1', 'categoryId=-1')],
    ['categoryId 為小數', valid.replace('categoryId=1', 'categoryId=1.5')],
    ['item 為空', valid.replace('item=早餐', 'item=')],
  ])('pick 欄位不合法：%s', (_name, data) => {
    expect(data).not.toBe(valid);
    expect(decodePostback(data)).toBeNull();
  });

  it('item 51 字（超出資料庫 VarChar(50)）→ null；50 字 → 合法', () => {
    expect(decodePostback(encodePick({ ...basePick, item: '品'.repeat(51) }))).toBeNull();
    expect(decodePostback(encodePick({ ...basePick, item: '品'.repeat(50) }))).not.toBeNull();
  });

  it.each([
    ['缺 id', 'action=delete'],
    ['id 非數字', 'action=delete&id=abc'],
    ['id 為 0', 'action=delete&id=0'],
    ['id 為負數', 'action=delete&id=-1'],
    ['id 為小數', 'action=delete&id=1.5'],
    ['id 為空', 'action=delete&id='],
    ['id 含尾端字元', 'action=delete&id=10x'],
  ])('delete %s', (_name, data) => {
    expect(decodePostback(data)).toBeNull();
  });

  it('SQL 注入樣式的 id 不被接受', () => {
    expect(decodePostback('action=delete&id=1;DROP TABLE transactions')).toBeNull();
    expect(decodePostback("action=delete&id=1' OR '1'='1")).toBeNull();
  });

  it('decode 永不拋例外（亂碼、超長字串）', () => {
    expect(() => decodePostback('%')).not.toThrow();
    expect(() => decodePostback('action=pick&item=%E4%B8')).not.toThrow();
    expect(() => decodePostback('a'.repeat(100_000))).not.toThrow();
    expect(decodePostback('%')).toBeNull();
  });
});
