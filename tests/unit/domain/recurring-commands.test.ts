import { describe, expect, it } from 'vitest';
import {
  decodePostback,
  encodeOccurrenceConfirm,
  encodeOccurrenceSkip,
} from '../../../src/domain/postback-codec';
import { parseTextEntry } from '../../../src/domain/text-entry-parser';
import {
  buildOccurrenceNotice,
  buildRecurringListReplies,
} from '../../../src/line/messages/recurring-replies';

describe('固定收支 postback', () => {
  it('rconfirm / rskip 編解碼', () => {
    expect(encodeOccurrenceConfirm(7)).toBe('action=rconfirm&id=7');
    expect(decodePostback(encodeOccurrenceConfirm(7))).toEqual({ action: 'rconfirm', id: 7 });
    expect(decodePostback(encodeOccurrenceSkip(8))).toEqual({ action: 'rskip', id: 8 });
  });

  it('id 不合法 → null', () => {
    expect(decodePostback('action=rconfirm&id=0')).toBeNull();
    expect(decodePostback('action=rskip')).toBeNull();
  });
});

describe('「固定」指令', () => {
  it('「固定」→ listRecurring；「固定 1」不是指令', () => {
    expect(parseTextEntry('固定')).toEqual({ kind: 'listRecurring' });
    expect(parseTextEntry(' 固定 ')).toEqual({ kind: 'listRecurring' });
    expect(parseTextEntry('固定 1').kind).not.toBe('listRecurring');
  });
});

describe('recurring-replies', () => {
  const occurrence = {
    id: 3,
    recurringEntryId: 1,
    ledger: 'personal' as const,
    entryType: 'expense' as const,
    item: '房租',
    amount: 15000,
    categoryId: 2,
    categoryName: '居住',
    note: null,
    dueOn: '2026-12-05',
    status: 'pending' as const,
  };

  it('到期推播：三個按鈕', () => {
    const notice = buildOccurrenceNotice(occurrence, 'liff-1');
    expect(notice.template.text).toBe('固定支出到期｜個人｜房租 15000 元｜分類：居住｜2026-12-05');
    expect(notice.template.actions).toEqual([
      {
        type: 'postback',
        label: '確認入帳',
        data: 'action=rconfirm&id=3',
        displayText: '確認入帳',
      },
      {
        type: 'uri',
        label: '修改金額',
        uri: 'https://liff.line.me/liff-1/recurring/occurrences/3',
      },
      { type: 'postback', label: '略過', data: 'action=rskip&id=3', displayText: '略過' },
    ]);
  });

  it('清單：含停用標記與待確認筆數', () => {
    const [text] = buildRecurringListReplies(
      [
        {
          id: 1,
          ledger: 'personal',
          entryType: 'income',
          item: '薪水',
          amount: 50000,
          categoryId: 9,
          categoryName: '薪資',
          dayOfMonth: 5,
          note: null,
          active: false,
          nextDueOn: '2026-12-05',
        },
      ],
      2,
      'liff-1',
    );
    expect(text).toEqual({
      type: 'text',
      text: '每月固定收支：\n・5 號 個人 +薪水 50000 元（停用）\n待確認：2 筆',
    });
  });

  it('清單：沒有規則', () => {
    const [text] = buildRecurringListReplies([], 0, 'liff-1');
    expect(text).toEqual({ type: 'text', text: '目前沒有設定每月固定收支' });
  });
});
