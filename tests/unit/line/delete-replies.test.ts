/**
 * 單元測試：刪除流程的 LINE 回覆 builder（純函式）
 *
 * 執行：npx vitest run tests/unit/line/delete-replies.test.ts
 *
 * 契約（nodejs-master 請遵循）：
 *   src/line/messages/delete-replies.ts（型別來自 src/ports/line-reply-gateway.ts）
 *     export interface DeleteSummaryInput { transactionId: number; item: string; amount: number; occurredOn: string（YYYY-MM-DD） }
 *     export function buildDeleteConfirmReply(input: DeleteSummaryInput): TemplateMessage;
 *       // template.type = 'confirm'；text = 「確定刪除？{項目} {金額} 元（{日期}）」（金額不加千分位）；
 *       // altText = 同 text；actions 恰兩個 postback，依序：
 *       //   { label: '確定', data: encodeConfirm(transactionId) }、{ label: '取消', data: encodeCancel(transactionId) }
 *     export function buildDeletedReply(input: Omit<DeleteSummaryInput, 'transactionId'>): TextMessage;
 *       // 「已刪除：{項目} {金額} 元（{日期}）」，無 quickReply
 *   src/line/messages/texts.ts 新增常數：
 *     export const RECORD_NOT_FOUND_TEXT = '此紀錄已不存在';
 *     export const DELETE_CANCELLED_TEXT = '已取消刪除';
 * 依據：specs/features/transaction/請求刪除記帳紀錄.feature、確認刪除記帳紀錄.feature；LINE confirm template text 上限 240。
 */
import { describe, expect, it } from 'vitest';
import { decodePostback } from '../../../src/domain/postback-codec';
import {
  buildDeleteConfirmReply,
  buildDeletedReply,
} from '../../../src/line/messages/delete-replies';
import { DELETE_CANCELLED_TEXT, RECORD_NOT_FOUND_TEXT } from '../../../src/line/messages/texts';

const base = { transactionId: 10, item: '午餐', amount: 120, occurredOn: '2026-11-12' };

describe('[Smoke] buildDeleteConfirmReply：規格範例', () => {
  it('午餐 120 元 → confirm template，文字與按鈕 data 逐字一致', () => {
    expect(buildDeleteConfirmReply(base)).toEqual({
      type: 'template',
      altText: '確定刪除？午餐 120 元（2026-11-12）',
      template: {
        type: 'confirm',
        text: '確定刪除？午餐 120 元（2026-11-12）',
        actions: [
          { type: 'postback', label: '確定', data: 'action=delete_confirm&id=10' },
          { type: 'postback', label: '取消', data: 'action=delete_cancel&id=10' },
        ],
      },
    });
  });
});

describe('[Happy] buildDeleteConfirmReply', () => {
  it('按鈕順序為「確定」在前、「取消」在後，data 可被 decodePostback 還原且 id 相同', () => {
    const message = buildDeleteConfirmReply({ ...base, transactionId: 4321 });
    const [confirm, cancel] = message.template.actions;
    expect(confirm).toMatchObject({ type: 'postback', label: '確定' });
    expect(cancel).toMatchObject({ type: 'postback', label: '取消' });
    expect(decodePostback((confirm as { data: string }).data)).toEqual({
      action: 'delete_confirm',
      id: 4321,
    });
    expect(decodePostback((cancel as { data: string }).data)).toEqual({
      action: 'delete_cancel',
      id: 4321,
    });
  });

  it('金額不加千分位；大金額照原數字', () => {
    const message = buildDeleteConfirmReply({ ...base, amount: 99_999_999 });
    expect(message.template.text).toBe('確定刪除？午餐 99999999 元（2026-11-12）');
  });

  it('只有兩個 action（不含 uri 等其他按鈕）', () => {
    expect(buildDeleteConfirmReply(base).template.actions).toHaveLength(2);
  });
});

describe('[Edge] buildDeleteConfirmReply：特殊項目文字', () => {
  it('項目含 Emoji、全形空白、& = + % 時原樣顯示，按鈕 data 不受影響', () => {
    const item = '咖啡☕　A&B=C+D%';
    const message = buildDeleteConfirmReply({ ...base, item });
    expect(message.template.text).toBe(`確定刪除？${item} 120 元（2026-11-12）`);
    const confirm = message.template.actions[0] as { data: string };
    expect(confirm.data).toBe('action=delete_confirm&id=10');
  });

  it('項目為 50 字上限時，text 仍 <= 240 且 altText <= 400', () => {
    const item = '長'.repeat(50);
    const message = buildDeleteConfirmReply({ ...base, item });
    expect(message.template.text.length).toBeLessThanOrEqual(240);
    expect(message.altText.length).toBeLessThanOrEqual(400);
    expect(message.template.text.startsWith('確定刪除？')).toBe(true);
    expect(message.template.text).toContain(item);
  });

  it('項目含 XSS / SQL 字樣只當純文字，不被轉義或改寫', () => {
    const item = "<script>alert(1)</script>'; DROP TABLE transactions;--";
    expect(buildDeleteConfirmReply({ ...base, item }).template.text).toBe(
      `確定刪除？${item} 120 元（2026-11-12）`,
    );
  });
});

describe('[Happy] buildDeletedReply', () => {
  it('規格範例：已刪除：午餐 120 元（2026-11-12）', () => {
    expect(buildDeletedReply({ item: '午餐', amount: 120, occurredOn: '2026-11-12' })).toEqual({
      type: 'text',
      text: '已刪除：午餐 120 元（2026-11-12）',
    });
  });

  it('使用全形冒號「：」與全形括號，不附 quickReply', () => {
    const message = buildDeletedReply({ item: '薪水', amount: 50000, occurredOn: '2026-01-31' });
    expect(message.text).toBe('已刪除：薪水 50000 元（2026-01-31）');
    expect(message.quickReply).toBeUndefined();
  });
});

describe('[Smoke] 固定文字常數逐字對應規格', () => {
  it('此紀錄已不存在', () => {
    expect(RECORD_NOT_FOUND_TEXT).toBe('此紀錄已不存在');
  });

  it('已取消刪除', () => {
    expect(DELETE_CANCELLED_TEXT).toBe('已取消刪除');
  });
});
