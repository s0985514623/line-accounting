/**
 * HTTP 測試：白名單文字記帳的 BDD 未涵蓋行為（POST /webhook/line，真實 PostgreSQL）
 *
 * 執行：TEST_DATABASE_URL=postgresql://test:test@localhost:5434/test npx vitest run tests/http/text-entry.test.ts
 *
 * 補強範圍（皆有對應 ASM / implementation-plan 依據）：
 *   - ASM-08：白名單文字記帳時分類數為 0 → 先 ensureDefaultCategories（19 筆）再比對；非 0 不補。
 *   - ASM-11：擁有者傳非文字訊息（貼圖、圖片…）→ 回格式說明；非白名單 → 回「此服務不開放使用」。
 *   - ASM-03 / ASM-04 / ASM-05：金額超過上限、項目過長、postback data 超過 300 字元的端到端行為。
 *   - 日期：以 Asia/Taipei 的「今天」記帳（UTC 15:59:59 / 16:00:00 邊界）。
 *   - 比對範圍：只比對同帳本同收支；名稱優先於關鍵字；關鍵字需完全相等。
 *   - token：每則未命中訊息產生不同 token（12 字元 base64url，implementation-plan P3-3）。
 *   - 安全：備註含 SQL / HTML 字串原樣儲存，資料表不受影響。
 *
 * 契約（nodejs-master 請遵循）：
 *   - 文字訊息由 text-message-handler 處理；業務錯誤一律 HTTP 200 + reply（不拋 5xx）。
 *   - 回覆文字：金額超過上限 =「金額超過上限」；項目過長 =「項目最多 50 字」；
 *     備註過長 =「備註太長，請縮短後重新傳送，或改用表單記帳」；格式錯誤 = FORMAT_HELP_TEXT。
 *   - 未命中時不寫入 transactions / postback_tokens / category_keywords（postback_tokens 只在 pick 完成時寫入）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertWithIds, queryRows } from '../bdd/support/db';
import { textEvent, type LineEvent } from '../bdd/support/line-event-factory';
import { FixedClock, RecordingLineGateway, type LineMessage } from '../bdd/support/stubs';
import {
  createWebhookHarness,
  postSigned,
  webhookBody,
  type WebhookHarness,
} from './support/webhook-harness';

const FORMAT_HELP = '格式：[公 ][+]項目 金額[ 備註]，例如：午餐 120、公 +顧問費 30000 A客戶';
const NOT_ALLOWED = '此服務不開放使用';
const NOTE_TOO_LONG = '備註太長，請縮短後重新傳送，或改用表單記帳';

let harness: WebhookHarness;

beforeAll(async () => {
  harness = await createWebhookHarness();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
});

// ---- 輔助 ---------------------------------------------------------------------------------

async function sendText(
  text: string,
  options: { userId?: string; clock?: FixedClock } = {},
): Promise<RecordingLineGateway> {
  const { app, line } = harness.makeApp(options.clock ? { clock: options.clock } : {});
  const response = await postSigned(
    app,
    webhookBody([textEvent(options.userId ?? 'U-owner', text)]),
  );
  expect(response.status).toBe(200);
  return line;
}

function firstMessage(line: RecordingLineGateway): LineMessage {
  expect(line.replies).toHaveLength(1);
  const message = line.replies[0]?.messages[0];
  if (!message) throw new Error('reply 不含任何訊息');
  return message;
}

function firstText(line: RecordingLineGateway): string {
  const message = firstMessage(line);
  return message.type === 'text' ? message.text : message.template.text;
}

function quickReplyItems(line: RecordingLineGateway) {
  const message = firstMessage(line);
  if (message.type !== 'text') throw new Error('預期 text 訊息');
  return (message.quickReply?.items ?? []).map((item) => item.action);
}

interface TxRow {
  ledger: string;
  entry_type: string;
  item: string;
  amount: number;
  category_name: string;
  occurred_on: string;
  note: string | null;
  source: string;
}

async function transactions(): Promise<TxRow[]> {
  return queryRows<TxRow>(
    harness.prisma,
    'SELECT t.ledger::text AS ledger, t.entry_type::text AS entry_type, t.item, t.amount, c.name AS category_name, ' +
      't.occurred_on::text AS occurred_on, t.note, t.source::text AS source ' +
      'FROM transactions t JOIN categories c ON c.id = t.category_id ORDER BY t.id',
  );
}

/** 與 BDD Background 相同的 8 個分類（指定 id）。 */
async function seedEightCategories(): Promise<void> {
  await insertWithIds(harness.prisma, 'categories', [
    { id: 1, ledger: 'personal', entry_type: 'expense', name: '餐飲', is_fallback: false },
    { id: 2, ledger: 'personal', entry_type: 'expense', name: '其他', is_fallback: true },
    { id: 3, ledger: 'personal', entry_type: 'income', name: '薪資', is_fallback: false },
    { id: 4, ledger: 'personal', entry_type: 'income', name: '其他', is_fallback: true },
    { id: 5, ledger: 'company', entry_type: 'expense', name: '文具', is_fallback: false },
    { id: 6, ledger: 'company', entry_type: 'expense', name: '其他', is_fallback: true },
    { id: 7, ledger: 'company', entry_type: 'income', name: '營業收入', is_fallback: false },
    { id: 8, ledger: 'company', entry_type: 'income', name: '其他', is_fallback: true },
  ]);
}

async function seedKeyword(
  categoryId: number,
  ledger: string,
  entryType: string,
  keyword: string,
): Promise<void> {
  await insertWithIds(harness.prisma, 'category_keywords', [
    { category_id: categoryId, ledger, entry_type: entryType, keyword },
  ]);
}

function categoryIdsOf(line: RecordingLineGateway): number[] {
  return quickReplyItems(line).map((a) => Number(new URLSearchParams(a.data).get('categoryId')));
}

/** 一個固定在指定 UTC 時間的時鐘（測 Asia/Taipei 日期邊界）。 */
class FrozenClock extends FixedClock {
  constructor(private readonly instant: Date) {
    super();
  }
  override now(): Date {
    return new Date(this.instant.getTime());
  }
  override today(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(this.instant);
  }
}

// ---- ASM-08：自動 seed ---------------------------------------------------------------------

describe('[Happy] 分類數為 0 時自動 seed 預設分類（ASM-08）', () => {
  it('第一則記帳訊息前沒有任何分類：先 seed 19 筆，再依名稱比對並記帳', async () => {
    expect(await harness.countRows('categories')).toBe(0);
    const line = await sendText('餐飲 120');

    expect(await harness.countRows('categories')).toBe(19);
    expect(firstText(line)).toBe('已記帳｜個人｜支出｜餐飲 120 元｜分類：餐飲｜2026-11-12');
    expect(await transactions()).toEqual([
      {
        ledger: 'personal',
        entry_type: 'expense',
        item: '餐飲',
        amount: 120,
        category_name: '餐飲',
        occurred_on: '2026-11-12',
        note: null,
        source: 'line_text',
      },
    ]);
  });

  it('0 分類且未命中名稱：seed 後回個人支出的 7 個分類按鈕（6 一般 + 其他），不記帳', async () => {
    const line = await sendText('早餐 80');
    expect(await harness.countRows('categories')).toBe(19);
    expect(firstText(line)).toBe('請選擇「早餐 80 元」的分類');
    expect(quickReplyItems(line).map((a) => a.label)).toEqual([
      '餐飲',
      '交通',
      '購物',
      '居住',
      '娛樂',
      '醫療',
      '其他',
    ]);
    expect(await harness.countRows('transactions')).toBe(0);
  });

  it('0 分類 + 公司收入前綴：seed 後以公司收入的分類比對（營業收入）', async () => {
    const line = await sendText('公 +營業收入 30000 A客戶');
    expect(firstText(line)).toBe(
      '已記帳｜公司｜收入｜營業收入 30000 元｜分類：營業收入｜2026-11-12',
    );
    expect((await transactions())[0]).toMatchObject({
      ledger: 'company',
      entry_type: 'income',
      note: 'A客戶',
    });
  });

  it('分類數不為 0 時不再 seed（即使只有 1 筆）', async () => {
    await insertWithIds(harness.prisma, 'categories', [
      { id: 1, ledger: 'personal', entry_type: 'expense', name: '餐飲', is_fallback: false },
    ]);
    const line = await sendText('餐飲 120');
    expect(await harness.countRows('categories')).toBe(1);
    expect(firstText(line)).toBe('已記帳｜個人｜支出｜餐飲 120 元｜分類：餐飲｜2026-11-12');
  });

  it('格式錯誤的訊息回格式說明、不記帳', async () => {
    const line = await sendText('你好嗎');
    expect(firstText(line)).toBe(FORMAT_HELP);
    expect(await harness.countRows('transactions')).toBe(0);
  });

  it('非白名單者的記帳訊息不觸發 seed', async () => {
    const line = await sendText('餐飲 120', { userId: 'U-stranger' });
    expect(firstText(line)).toBe(NOT_ALLOWED);
    expect(await harness.countRows('categories')).toBe(0);
  });
});

// ---- ASM-11：非文字訊息 --------------------------------------------------------------------

describe('[Edge] 非文字訊息（ASM-11）', () => {
  function nonText(userId: string, type: string): LineEvent {
    const base = textEvent(userId, 'ignored');
    return { ...base, message: { type, id: '1234567890' } } as unknown as LineEvent;
  }

  it.each(['sticker', 'image', 'video', 'audio', 'location', 'file'])(
    '擁有者傳 %s：回格式說明、不記帳',
    async (type) => {
      const { app, line } = harness.makeApp();
      const response = await postSigned(app, webhookBody([nonText('U-owner', type)]));
      expect(response.status).toBe(200);
      expect(firstText(line)).toBe(FORMAT_HELP);
      expect(await harness.countRows('transactions')).toBe(0);
    },
  );

  it('非白名單者傳貼圖：回「此服務不開放使用」', async () => {
    const { app, line } = harness.makeApp();
    await postSigned(app, webhookBody([nonText('U-stranger', 'sticker')]));
    expect(firstText(line)).toBe(NOT_ALLOWED);
  });

  it('同一次 webhook 先貼圖再文字：兩個事件都處理（各回一次）', async () => {
    const { app, line } = harness.makeApp();
    await postSigned(
      app,
      webhookBody([nonText('U-owner', 'sticker'), textEvent('U-owner', '餐飲 120')]),
    );
    expect(line.replies).toHaveLength(2);
    expect(await harness.countRows('transactions')).toBe(1);
  });
});

// ---- ASM-03 / ASM-04 / ASM-05 --------------------------------------------------------------

describe('[Edge] 金額上限（ASM-03）', () => {
  it('99999999 → 記帳成功', async () => {
    const line = await sendText('餐飲 99999999');
    expect(firstText(line)).toBe('已記帳｜個人｜支出｜餐飲 99999999 元｜分類：餐飲｜2026-11-12');
    expect((await transactions())[0]).toMatchObject({ amount: 99999999 });
  });

  it('100000000 → 回「金額超過上限」且不記帳', async () => {
    const line = await sendText('餐飲 100000000');
    expect(firstText(line)).toBe('金額超過上限');
    expect(await harness.countRows('transactions')).toBe(0);
  });

  it('全形超大金額、30 位數金額 → 同樣回「金額超過上限」', async () => {
    expect(firstText(await sendText('餐飲 １００００００００'))).toBe('金額超過上限');
    expect(firstText(await sendText(`餐飲 ${'9'.repeat(30)}`))).toBe('金額超過上限');
    expect(await harness.countRows('transactions')).toBe(0);
  });
});

describe('[Edge] 項目長度（ASM-04）', () => {
  it('51 字 → 回「項目最多 50 字」且不記帳', async () => {
    const line = await sendText(`${'品'.repeat(51)} 100`);
    expect(firstText(line)).toBe('項目最多 50 字');
    expect(await harness.countRows('transactions')).toBe(0);
  });

  it('50 字（未命中分類）→ 正常進入分類選擇，提示文字含完整項目', async () => {
    const item = '品'.repeat(50);
    const line = await sendText(`${item} 100`);
    expect(firstText(line)).toBe(`請選擇「${item} 100 元」的分類`);
    const data = new URLSearchParams(quickReplyItems(line)[0]?.data);
    expect(data.get('item')).toBe(item);
  });
});

describe('[Edge] postback data 300 字元上限（ASM-05）', () => {
  /** 以一次探測訊息取得單位長度，回傳讓最長按鈕 data 剛好為 target 的備註。 */
  async function noteForDataLength(target: number): Promise<string> {
    const probe = await sendText('早餐 80 a');
    const lengths = quickReplyItems(probe).map((a) => a.data.length);
    const longest = Math.max(...lengths);
    // 探測備註為 1 字元；補足到 target
    return 'a'.repeat(target - (longest - 1));
  }

  it('最長按鈕 data 剛好 300 → 回分類按鈕', async () => {
    const note = await noteForDataLength(300);
    const line = await sendText(`早餐 80 ${note}`);
    const items = quickReplyItems(line);
    expect(items.length).toBeGreaterThan(0);
    expect(Math.max(...items.map((a) => a.data.length))).toBe(300);
  });

  it('301 → 回「備註太長…」純文字，無按鈕，且不記帳、不寫 token', async () => {
    const note = await noteForDataLength(301);
    const line = await sendText(`早餐 80 ${note}`);
    const message = firstMessage(line);
    expect(message).toEqual({ type: 'text', text: NOTE_TOO_LONG });
    expect(await harness.countRows('transactions')).toBe(0);
    expect(await harness.countRows('postback_tokens')).toBe(0);
  });

  it('已命中分類的記帳不受備註長度影響（不產生 postback，1000 字備註仍記帳）', async () => {
    const note = '備'.repeat(1000);
    const line = await sendText(`餐飲 120 ${note}`);
    expect(firstText(line).startsWith('已記帳｜個人｜支出｜餐飲 120 元')).toBe(true);
    expect((await transactions())[0]).toMatchObject({ note });
  });
});

// ---- 日期（Asia/Taipei） -------------------------------------------------------------------

describe('[Edge] 記帳日期為 Asia/Taipei 的今天', () => {
  it('UTC 2026-11-12T15:59:59Z（台北 23:59:59）→ 2026-11-12', async () => {
    await seedEightCategories();
    const line = await sendText('餐飲 120', {
      clock: new FrozenClock(new Date('2026-11-12T15:59:59Z')),
    });
    expect(firstText(line)).toContain('｜2026-11-12');
    expect((await transactions())[0]).toMatchObject({ occurred_on: '2026-11-12' });
  });

  it('UTC 2026-11-12T16:00:00Z（台北隔日 00:00）→ 2026-11-13', async () => {
    await seedEightCategories();
    const line = await sendText('餐飲 120', {
      clock: new FrozenClock(new Date('2026-11-12T16:00:00Z')),
    });
    expect(firstText(line)).toContain('｜2026-11-13');
    expect((await transactions())[0]).toMatchObject({ occurred_on: '2026-11-13' });
  });

  it('跨年：UTC 2026-12-31T16:00:00Z → 2027-01-01', async () => {
    await seedEightCategories();
    await sendText('餐飲 120', { clock: new FrozenClock(new Date('2026-12-31T16:00:00Z')) });
    expect((await transactions())[0]).toMatchObject({ occurred_on: '2027-01-01' });
  });

  it('未命中時分類按鈕的 data.date 同樣是台北的今天', async () => {
    await seedEightCategories();
    const line = await sendText('早餐 80', {
      clock: new FrozenClock(new Date('2026-11-12T16:00:00Z')),
    });
    expect(new URLSearchParams(quickReplyItems(line)[0]?.data).get('date')).toBe('2026-11-13');
  });
});

// ---- 比對範圍與優先序 ----------------------------------------------------------------------

describe('[Edge] 分類比對：限同帳本同收支、名稱優先於關鍵字、關鍵字完全相等', () => {
  beforeEach(async () => {
    await seedEightCategories();
  });

  it('「文具」只存在於公司支出：個人「文具 300」視為未命中 → 個人支出按鈕(1,2)', async () => {
    const line = await sendText('文具 300');
    expect(categoryIdsOf(line)).toEqual([1, 2]);
    expect(await harness.countRows('transactions')).toBe(0);
  });

  it('「公 餐飲 100」：餐飲只在個人支出 → 公司支出按鈕(5,6)', async () => {
    const line = await sendText('公 餐飲 100');
    expect(categoryIdsOf(line)).toEqual([5, 6]);
  });

  it('「+餐飲 100」：餐飲是支出分類 → 個人收入按鈕(3,4)', async () => {
    const line = await sendText('+餐飲 100');
    expect(categoryIdsOf(line)).toEqual([3, 4]);
  });

  it('「公 +文具 100」：公司收入按鈕(7,8)', async () => {
    const line = await sendText('公 +文具 100');
    expect(categoryIdsOf(line)).toEqual([7, 8]);
  });

  it('名稱優先於關鍵字：關鍵字「餐飲」指向其他，仍歸入名稱相符的「餐飲」', async () => {
    await seedKeyword(2, 'personal', 'expense', '餐飲');
    await sendText('餐飲 120');
    expect((await transactions())[0]).toMatchObject({ category_name: '餐飲' });
  });

  it('關鍵字必須完全相等：「午餐便當」不命中關鍵字「午餐」', async () => {
    await seedKeyword(1, 'personal', 'expense', '午餐');
    const line = await sendText('午餐便當 120');
    expect(categoryIdsOf(line)).toEqual([1, 2]);
    expect(await harness.countRows('transactions')).toBe(0);
  });

  it('其他帳本的關鍵字不套用：公司關鍵字「影印」不影響個人「影印 50」', async () => {
    await seedKeyword(5, 'company', 'expense', '影印');
    const line = await sendText('影印 50');
    expect(categoryIdsOf(line)).toEqual([1, 2]);
  });

  it('同帳本同收支的關鍵字命中：公司「公 影印 50」歸入文具', async () => {
    await seedKeyword(5, 'company', 'expense', '影印');
    await sendText('公 影印 50');
    expect((await transactions())[0]).toMatchObject({
      ledger: 'company',
      item: '影印',
      category_name: '文具',
    });
  });

  it('項目名稱等於「其他」→ 依名稱歸入「其他」分類', async () => {
    await sendText('其他 100');
    expect((await transactions())[0]).toMatchObject({ item: '其他', category_name: '其他' });
  });

  it('命中時不新增關鍵字（學習只發生在 pick 完成時）', async () => {
    await sendText('餐飲 120');
    expect(await harness.countRows('transactions')).toBe(1);
    expect(await harness.countRows('category_keywords')).toBe(0);
  });
});

// ---- token 與重複訊息 ----------------------------------------------------------------------

describe('[Edge] 重複訊息與 token', () => {
  beforeEach(async () => {
    await seedEightCategories();
  });

  it('同一則命中訊息送兩次 → 兩筆紀錄（不做訊息去重）', async () => {
    await sendText('餐飲 120');
    await sendText('餐飲 120');
    expect(await harness.countRows('transactions')).toBe(2);
  });

  it('同一則未命中訊息送兩次 → 兩組不同 token，皆為 12 字元 base64url，且仍不寫入任何資料', async () => {
    const tokenOf = (line: RecordingLineGateway) => {
      const tokens = new Set(
        quickReplyItems(line).map((a) => new URLSearchParams(a.data).get('token')),
      );
      expect(tokens.size).toBe(1);
      return [...tokens][0] as string;
    };
    const first = tokenOf(await sendText('早餐 80'));
    const second = tokenOf(await sendText('早餐 80'));
    expect(first).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(first).not.toBe(second);
    expect(await harness.countRows('transactions')).toBe(0);
    expect(await harness.countRows('postback_tokens')).toBe(0);
  });

  it('一次 webhook 帶兩則文字：依序各記一筆', async () => {
    const { app, line } = harness.makeApp();
    await postSigned(
      app,
      webhookBody([textEvent('U-owner', '餐飲 100'), textEvent('U-owner', '餐飲 200')]),
    );
    expect(line.replies).toHaveLength(2);
    expect((await transactions()).map((t) => t.amount)).toEqual([100, 200]);
  });
});

// ---- 安全 ----------------------------------------------------------------------------------

describe('[Security] 備註原樣儲存，不被當成 SQL / HTML 執行', () => {
  beforeEach(async () => {
    await seedEightCategories();
  });

  it('備註含 SQL 注入字串：資料表仍在、備註逐字儲存', async () => {
    const note = "'); DROP TABLE transactions;-- <script>alert(1)</script>";
    const line = await sendText(`餐飲 120 ${note}`);
    expect(firstText(line).startsWith('已記帳｜')).toBe(true);
    expect(await harness.countRows('transactions')).toBe(1);
    expect((await transactions())[0]).toMatchObject({ note });
  });

  it('備註含 Emoji、RTL 控制字元、& = + % 皆原樣儲存', async () => {
    const note = '🍜 \u202Eabc a&b=c+d%e';
    await sendText(`餐飲 120 ${note}`);
    expect((await transactions())[0]).toMatchObject({ note });
  });
});
