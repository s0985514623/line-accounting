/**
 * 單元測試：postback codec 的刪除流程編解碼（delete_confirm / delete_cancel）
 *
 * 執行：npx vitest run tests/unit/domain/postback-codec.delete.test.ts
 *
 * 契約（nodejs-master 請遵循）——src/domain/postback-codec.ts 新增：
 *   export function encodeConfirm(id: number): string;   // 'action=delete_confirm&id=<id>'
 *   export function encodeCancel(id: number): string;    // 'action=delete_cancel&id=<id>'
 *   PostbackPayload 增加 { action: 'delete_confirm'; id: number } | { action: 'delete_cancel'; id: number }
 *   decodePostback 對兩者的 id 規則與 delete 相同（正整數、無前導 0、<= int4 上限、不得缺欄位 / 多欄位 / 重複欄位），
 *   不合法一律回 null（永不拋出）。
 * 依據：specs/features/transaction/請求刪除記帳紀錄.feature、確認刪除記帳紀錄.feature（postback 字串逐字一致）。
 */
import { describe, expect, it } from 'vitest';
import {
  decodePostback,
  encodeCancel,
  encodeConfirm,
  encodeDelete,
  isPostbackDataWithinLimit,
} from '../../../src/domain/postback-codec';

describe('[Smoke] 規格範例逐字一致', () => {
  it('encodeConfirm(10) = action=delete_confirm&id=10', () => {
    expect(encodeConfirm(10)).toBe('action=delete_confirm&id=10');
  });

  it('encodeCancel(10) = action=delete_cancel&id=10', () => {
    expect(encodeCancel(10)).toBe('action=delete_cancel&id=10');
  });

  it('decodePostback 還原 delete_confirm / delete_cancel', () => {
    expect(decodePostback('action=delete_confirm&id=10')).toEqual({
      action: 'delete_confirm',
      id: 10,
    });
    expect(decodePostback('action=delete_cancel&id=10')).toEqual({
      action: 'delete_cancel',
      id: 10,
    });
  });
});

describe('[Happy] 往返', () => {
  it.each([1, 10, 98765, 2_147_483_647])('id=%i 三種 action 皆可往返', (id) => {
    expect(decodePostback(encodeDelete(id))).toEqual({ action: 'delete', id });
    expect(decodePostback(encodeConfirm(id))).toEqual({ action: 'delete_confirm', id });
    expect(decodePostback(encodeCancel(id))).toEqual({ action: 'delete_cancel', id });
  });

  it('資料長度遠低於 300 字元上限', () => {
    expect(isPostbackDataWithinLimit(encodeConfirm(2_147_483_647))).toBe(true);
    expect(isPostbackDataWithinLimit(encodeCancel(2_147_483_647))).toBe(true);
  });
});

describe('[Error/Edge/Security] 不合法 data 一律回 null', () => {
  const invalidQueries: Array<[string, string]> = [
    ['缺 id', 'action=ACTION'],
    ['id 非數字', 'action=ACTION&id=abc'],
    ['id 為 0', 'action=ACTION&id=0'],
    ['id 為負數', 'action=ACTION&id=-1'],
    ['id 為小數', 'action=ACTION&id=1.5'],
    ['id 為空', 'action=ACTION&id='],
    ['id 含前導 0', 'action=ACTION&id=010'],
    ['id 含尾端字元', 'action=ACTION&id=10x'],
    ['id 超過 int4 上限', 'action=ACTION&id=2147483648'],
    ['id 為科學記號', 'action=ACTION&id=1e3'],
    ['重複 id', 'action=ACTION&id=1&id=2'],
    ['多餘欄位', 'action=ACTION&id=1&extra=1'],
    ['夾帶 pick 專用欄位', 'action=ACTION&id=10&token=abc'],
    ['SQL 注入字樣', "action=ACTION&id=1' OR '1'='1"],
  ];

  describe.each(['delete_confirm', 'delete_cancel'])('%s', (action) => {
    it.each(invalidQueries)('%s', (_name, template) => {
      expect(decodePostback(template.replace('ACTION', action))).toBeNull();
    });
  });

  it('未知的相近 action 不被接受', () => {
    expect(decodePostback('action=delete_confirmed&id=10')).toBeNull();
    expect(decodePostback('action=delete-confirm&id=10')).toBeNull();
    expect(decodePostback('action=DELETE_CONFIRM&id=10')).toBeNull();
    expect(decodePostback('action=delete_cancelled&id=10')).toBeNull();
  });

  it('action 重複（delete_confirm 夾帶 delete）→ null，避免繞過確認', () => {
    expect(decodePostback('action=delete_confirm&action=delete&id=10')).toBeNull();
  });
});
