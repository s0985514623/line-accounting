/**
 * TransactionFormPage（新增 /liff/new、編輯 /liff/edit/:id → 元件內路徑 "/new"、"/edit/:id"）
 *
 * 執行：npm --prefix web test -- src/pages/TransactionFormPage.test.tsx
 * 對應規格：specs/features/transaction/以表單記帳.feature、編輯記帳紀錄.feature
 *
 * 假設的模組介面：
 *   web/src/pages/TransactionFormPage.tsx   export function TransactionFormPage()   （具名匯出、無 props）
 *   - 模式由路由決定：有 :id 參數 → 編輯，否則新增
 *   - 編輯模式的預填來源：navigate(`/edit/${id}`, { state: { transaction } })（列表頁帶入；api.yml 沒有單筆 GET）
 *     沒有 state（例如直接開網址）→ role="alert" 顯示「找不到要編輯的紀錄」並提供 link「返回列表」→ "/"
 *
 * 測試依賴的 accessible name / 文案（react-master 請照此實作）：
 *   - 標題：heading「新增記帳」／「編輯記帳」
 *   - 帳本：radio「個人」「公司」（預設個人）；收支：radio「支出」「收入」（預設支出）
 *   - 項目：textbox，label「項目」；金額：spinbutton（<input type="number">），label「金額」；備註：textbox，label「備註」
 *   - 日期：<input type="date">，label「日期」，新增時預設今天（Asia/Taipei）YYYY-MM-DD
 *   - 分類：<select>，label「分類」；第一個 option「請選擇」(value=""；注意不可與驗證訊息「請選擇分類」同字)；其後依 GET /api/categories 順序，option value = 分類 id
 *   - 送出：button，name 含「儲存」（送出中可改為「儲存中…」，必須 disabled）
 *   - 驗證訊息（顯示為文字）：「請輸入項目」「項目最多 50 個字」「請輸入大於 0 的整數金額」
 *       「金額不可超過 99,999,999」「請選擇分類」「請選擇日期」
 *   - 送出失敗：role="alert"，內容為 ApiError.message（中文對照）；表單輸入全數保留
 *   - 送出成功：navigate("/")（回列表）；ASM-14：即使 liff.isInClient() 為 true 也不得呼叫 liff.closeWindow()
 *   - 請求內容：POST/PUT body = { ledger, entryType, item(trim), amount(number), categoryId(number), occurredOn, note(空字串→null) }
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionFormPage } from './TransactionFormPage';
import {
  errorResponse,
  http,
  HttpResponse,
  requestsTo,
  seedTransactions,
  VALID_ID_TOKEN,
  type TransactionRow,
} from '../test/mocks/handlers';
import { liffMock } from '../test/mocks/liff';
import { server } from '../test/mocks/server';
import { renderRoutes } from '../test/render';

function freezeNow(iso = '2026-11-12T04:00:00Z') {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

const routes = [
  { path: '/new', element: <TransactionFormPage /> },
  { path: '/edit/:id', element: <TransactionFormPage /> },
  { path: '/', element: <div>列表頁</div> },
];

async function renderCreate() {
  const utils = renderRoutes(routes, '/new');
  await screen.findByRole('option', { name: '餐飲' });
  return utils;
}

async function renderEdit(id: 10 | 11 | 12 = 10) {
  const transaction = seedTransactions.find((t) => t.id === id) as TransactionRow;
  const utils = renderRoutes(routes, { pathname: `/edit/${id}`, state: { transaction } });
  await screen.findByRole('heading', { name: '編輯記帳' });
  return utils;
}

const categorySelect = () => screen.getByLabelText('分類');
const submitButton = () => screen.getByRole('button', { name: /儲存/ });
const lastBody = (method: 'POST' | 'PUT') => {
  const path = method === 'POST' ? '/api/transactions' : /^\/api\/transactions\/\d+$/;
  return requestsTo(method, path).at(-1)?.body as Record<string, unknown> | undefined;
};
const categoryRequests = () => requestsTo('GET', '/api/categories');

async function fillBasic(
  user: UserEvent,
  opts: { item?: string; amount?: string; category?: string; note?: string } = {},
) {
  const { item = '午餐', amount = '120', category = '餐飲', note } = opts;
  await user.type(screen.getByLabelText('項目'), item);
  await user.type(screen.getByLabelText('金額'), amount);
  await user.selectOptions(categorySelect(), category);
  if (note) await user.type(screen.getByLabelText('備註'), note);
}

beforeEach(() => {
  freezeNow();
});

describe('TransactionFormPage / 新增', () => {
  describe('Smoke', () => {
    it('初始畫面：預設 個人／支出、日期為今天（Taipei）、分類未選且依序列出一般分類與「其他」', async () => {
      await renderCreate();

      expect(screen.getByRole('heading', { name: '新增記帳' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: '個人' })).toBeChecked();
      expect(screen.getByRole('radio', { name: '支出' })).toBeChecked();
      expect(screen.getByLabelText('日期')).toHaveValue('2026-11-12');
      expect(categorySelect()).toHaveValue('');
      expect(
        within(categorySelect())
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['請選擇', '餐飲', '交通', '其他']);
      expect(categoryRequests().at(-1)?.query).toEqual({
        ledger: 'personal',
        entryType: 'expense',
      });
    });
  });

  describe('Happy', () => {
    it('填寫後送出 → POST 正確內容 → 回列表；ASM-14：不呼叫 liff.closeWindow（即使在 LINE App 內）', async () => {
      liffMock.isInClient.mockReturnValue(true);
      const { user } = await renderCreate();

      await fillBasic(user, { note: '和朋友' });
      fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-11-10' } });
      await user.click(submitButton());

      await waitFor(() =>
        expect(screen.getByTestId('location-pathname')).toHaveTextContent(/^\/$/),
      );
      expect(screen.getByText('列表頁')).toBeInTheDocument();
      expect(lastBody('POST')).toEqual({
        ledger: 'personal',
        entryType: 'expense',
        item: '午餐',
        amount: 120,
        categoryId: 1,
        occurredOn: '2026-11-10',
        note: '和朋友',
      });
      expect(requestsTo('POST', '/api/transactions')[0]?.authorization).toBe(
        `Bearer ${VALID_ID_TOKEN}`,
      );
      expect(liffMock.closeWindow).not.toHaveBeenCalled();
    });

    it('備註留空 → 以 null 送出；項目前後空白會被 trim', async () => {
      const { user } = await renderCreate();

      await fillBasic(user, { item: '  午餐  ' });
      await user.click(submitButton());

      await waitFor(() => expect(requestsTo('POST', '/api/transactions')).toHaveLength(1));
      expect(lastBody('POST')?.item).toBe('午餐');
      expect(lastBody('POST')?.note ?? null).toBeNull();
    });

    it('切換成 公司／收入 後送出：分類改載入 公司／收入，payload 帶對應帳本與分類', async () => {
      const { user } = await renderCreate();

      await user.click(screen.getByRole('radio', { name: '公司' }));
      await user.click(screen.getByRole('radio', { name: '收入' }));
      await screen.findByRole('option', { name: '營業收入' });
      await user.type(screen.getByLabelText('項目'), '專案款');
      await user.type(screen.getByLabelText('金額'), '50000');
      await user.selectOptions(categorySelect(), '營業收入');
      await user.click(submitButton());

      await waitFor(() => expect(requestsTo('POST', '/api/transactions')).toHaveLength(1));
      expect(lastBody('POST')).toMatchObject({
        ledger: 'company',
        entryType: 'income',
        categoryId: 11,
        amount: 50000,
      });
    });

    it('Taipei 午夜邊界：UTC 11/30 16:30 → 日期預設 2026-12-01', async () => {
      freezeNow('2026-11-30T16:30:00Z');
      await renderCreate();

      expect(screen.getByLabelText('日期')).toHaveValue('2026-12-01');
    });
  });

  describe('切換帳本／收支 → 重新載入分類並清空已選分類', () => {
    it('切換帳本：重新查詢該帳本分類、已選分類被清空、舊帳本的分類消失', async () => {
      const { user } = await renderCreate();
      await user.selectOptions(categorySelect(), '餐飲');
      expect(categorySelect()).toHaveValue('1');

      await user.click(screen.getByRole('radio', { name: '公司' }));

      expect(await screen.findByRole('option', { name: '文具' })).toBeInTheDocument();
      expect(categoryRequests().at(-1)?.query).toEqual({ ledger: 'company', entryType: 'expense' });
      expect(categorySelect()).toHaveValue('');
      expect(screen.queryByRole('option', { name: '餐飲' })).not.toBeInTheDocument();
    });

    it('切換收支：重新查詢、已選分類被清空', async () => {
      const { user } = await renderCreate();
      await user.selectOptions(categorySelect(), '餐飲');

      await user.click(screen.getByRole('radio', { name: '收入' }));

      expect(await screen.findByRole('option', { name: '薪資' })).toBeInTheDocument();
      expect(categoryRequests().at(-1)?.query).toEqual({ ledger: 'personal', entryType: 'income' });
      expect(categorySelect()).toHaveValue('');
    });

    it('清空後直接送出 → 顯示「請選擇分類」，不會用舊分類 id 送出', async () => {
      const { user } = await renderCreate();
      await user.type(screen.getByLabelText('項目'), '午餐');
      await user.type(screen.getByLabelText('金額'), '120');
      await user.selectOptions(categorySelect(), '餐飲');

      await user.click(screen.getByRole('radio', { name: '公司' }));
      await screen.findByRole('option', { name: '文具' });
      await user.click(submitButton());

      expect(await screen.findByText('請選擇分類')).toBeInTheDocument();
      expect(requestsTo('POST', '/api/transactions')).toHaveLength(0);
    });

    it('切換帳本不會清掉已填的項目、金額、備註、日期', async () => {
      const { user } = await renderCreate();
      await fillBasic(user, { note: '備註文字' });
      fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-11-03' } });

      await user.click(screen.getByRole('radio', { name: '公司' }));
      await screen.findByRole('option', { name: '文具' });

      expect(screen.getByLabelText('項目')).toHaveValue('午餐');
      expect(screen.getByLabelText('金額')).toHaveValue(120);
      expect(screen.getByLabelText('備註')).toHaveValue('備註文字');
      expect(screen.getByLabelText('日期')).toHaveValue('2026-11-03');
    });
  });

  describe('Error：前端驗證（不發送請求）', () => {
    it('全部留空送出 → 顯示三則必填訊息，且沒有 POST', async () => {
      const { user } = await renderCreate();

      await user.click(submitButton());

      expect(await screen.findByText('請輸入項目')).toBeInTheDocument();
      expect(screen.getByText('請輸入大於 0 的整數金額')).toBeInTheDocument();
      expect(screen.getByText('請選擇分類')).toBeInTheDocument();
      expect(requestsTo('POST', '/api/transactions')).toHaveLength(0);
    });

    it.each([
      ['0', '請輸入大於 0 的整數金額'],
      ['-1', '請輸入大於 0 的整數金額'],
      ['12.5', '請輸入大於 0 的整數金額'],
      ['100000000', '金額不可超過 99,999,999'],
    ])('金額 %s → 「%s」且不送出', async (amount, message) => {
      const { user } = await renderCreate();
      await user.type(screen.getByLabelText('項目'), '午餐');
      await user.selectOptions(categorySelect(), '餐飲');
      fireEvent.change(screen.getByLabelText('金額'), { target: { value: amount } });

      await user.click(submitButton());

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(requestsTo('POST', '/api/transactions')).toHaveLength(0);
    });

    it.each([
      ['  ', '請輸入項目'],
      ['長'.repeat(51), '項目最多 50 個字'],
    ])('項目「%s」→ 「%s」且不送出', async (item, message) => {
      const { user } = await renderCreate();
      await user.type(screen.getByLabelText('金額'), '120');
      await user.selectOptions(categorySelect(), '餐飲');
      fireEvent.change(screen.getByLabelText('項目'), { target: { value: item } });

      await user.click(submitButton());

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(requestsTo('POST', '/api/transactions')).toHaveLength(0);
    });

    it('日期被清空 → 「請選擇日期」且不送出', async () => {
      const { user } = await renderCreate();
      await fillBasic(user);
      fireEvent.change(screen.getByLabelText('日期'), { target: { value: '' } });

      await user.click(submitButton());

      expect(await screen.findByText('請選擇日期')).toBeInTheDocument();
      expect(requestsTo('POST', '/api/transactions')).toHaveLength(0);
    });

    it.each([
      ['1', 1],
      ['99999999', 99_999_999],
    ])('金額邊界 %s 可送出', async (amount, expected) => {
      const { user } = await renderCreate();
      await fillBasic(user, { amount });

      await user.click(submitButton());

      await waitFor(() => expect(requestsTo('POST', '/api/transactions')).toHaveLength(1));
      expect(lastBody('POST')?.amount).toBe(expected);
    });

    it('項目剛好 50 字可送出', async () => {
      const { user } = await renderCreate();
      await fillBasic(user, { item: '長' });
      fireEvent.change(screen.getByLabelText('項目'), { target: { value: '長'.repeat(50) } });

      await user.click(submitButton());

      await waitFor(() => expect(requestsTo('POST', '/api/transactions')).toHaveLength(1));
    });
  });

  describe('Edge：重複送出', () => {
    it('雙擊「儲存」只發出一次 POST', async () => {
      server.use(
        http.post('*/api/transactions', async ({ request }) => {
          await new Promise((r) => setTimeout(r, 50));
          return HttpResponse.json(
            {
              id: 200,
              ...((await request.json()) as object),
              categoryName: '餐飲',
              source: 'liff_form',
            },
            { status: 201 },
          );
        }),
      );
      const { user } = await renderCreate();
      await fillBasic(user);

      await user.dblClick(submitButton());

      await waitFor(() =>
        expect(screen.getByTestId('location-pathname')).toHaveTextContent(/^\/$/),
      );
      expect(requestsTo('POST', '/api/transactions')).toHaveLength(1);
    });

    it('送出中按鈕 disabled，完成後離開表單', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      server.use(
        http.post('*/api/transactions', async () => {
          await gate;
          return HttpResponse.json(
            {
              id: 200,
              ledger: 'personal',
              entryType: 'expense',
              item: '午餐',
              amount: 120,
              categoryId: 1,
              categoryName: '餐飲',
              occurredOn: '2026-11-12',
              note: null,
              source: 'liff_form',
            },
            { status: 201 },
          );
        }),
      );
      const { user } = await renderCreate();
      await fillBasic(user);

      await user.click(submitButton());

      await waitFor(() => expect(submitButton()).toBeDisabled());
      await act(async () => release());
      await waitFor(() =>
        expect(screen.getByTestId('location-pathname')).toHaveTextContent(/^\/$/),
      );
    });
  });

  describe('Error：伺服器與網路錯誤（保留使用者輸入、停留在表單）', () => {
    it.each([
      [400, 'CATEGORY_MISMATCH', '所選分類與帳本或收支不符，請重新選擇分類'],
      [404, 'NOT_FOUND', '找不到指定的資料'],
      [400, 'INVALID_ARGUMENT', '輸入的資料有誤，請檢查後再試'],
      [403, 'FORBIDDEN', '您沒有使用此服務的權限'],
    ] as const)('POST 回 %i %s → 顯示「%s」並保留輸入', async (status, violationType, message) => {
      server.use(http.post('*/api/transactions', () => errorResponse(status, violationType)));
      const { user } = await renderCreate();
      await fillBasic(user, { note: '和朋友' });

      await user.click(submitButton());

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/new');
      expect(screen.getByLabelText('項目')).toHaveValue('午餐');
      expect(screen.getByLabelText('金額')).toHaveValue(120);
      expect(categorySelect()).toHaveValue('1');
      expect(screen.getByLabelText('備註')).toHaveValue('和朋友');
      expect(submitButton()).toBeEnabled();
    });

    it('網路錯誤 → 顯示網路訊息、保留全部輸入；再次送出成功後回列表', async () => {
      server.use(http.post('*/api/transactions', () => HttpResponse.error(), { once: true }));
      const { user } = await renderCreate();
      await fillBasic(user, { note: '和朋友' });
      fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-11-08' } });

      await user.click(submitButton());

      expect(await screen.findByRole('alert')).toHaveTextContent('網路連線失敗，請檢查網路後再試');
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/new');
      expect(screen.getByLabelText('項目')).toHaveValue('午餐');
      expect(screen.getByLabelText('金額')).toHaveValue(120);
      expect(categorySelect()).toHaveValue('1');
      expect(screen.getByLabelText('備註')).toHaveValue('和朋友');
      expect(screen.getByLabelText('日期')).toHaveValue('2026-11-08');
      expect(submitButton()).toBeEnabled();

      await user.click(submitButton());

      await waitFor(() =>
        expect(screen.getByTestId('location-pathname')).toHaveTextContent(/^\/$/),
      );
      expect(requestsTo('POST', '/api/transactions')).toHaveLength(2);
      expect(lastBody('POST')).toMatchObject({
        item: '午餐',
        amount: 120,
        occurredOn: '2026-11-08',
        note: '和朋友',
      });
    });

    it('送出時 401（token 過期）→ liff.login 後自動重送一次並成功', async () => {
      server.use(
        http.post('*/api/transactions', () => errorResponse(401, 'UNAUTHENTICATED'), {
          once: true,
        }),
      );
      const { user } = await renderCreate();
      await fillBasic(user);

      await user.click(submitButton());

      await waitFor(() =>
        expect(screen.getByTestId('location-pathname')).toHaveTextContent(/^\/$/),
      );
      expect(liffMock.login).toHaveBeenCalledTimes(1);
      expect(requestsTo('POST', '/api/transactions')).toHaveLength(2);
    });

    it('分類清單載入失敗 → 顯示錯誤訊息（role=alert）', async () => {
      server.use(http.get('*/api/categories', () => new HttpResponse(null, { status: 500 })));
      renderRoutes(routes, '/new');

      expect(await screen.findByRole('alert')).toHaveTextContent('伺服器發生錯誤，請稍後再試');
    });
  });

  describe('Security / Unicode', () => {
    it('項目與備註含 HTML、Emoji 時原樣送出（不在前端轉義或截斷）', async () => {
      const { user } = await renderCreate();
      await user.type(screen.getByLabelText('項目'), '<b>午餐</b>🍜');
      await user.type(screen.getByLabelText('金額'), '120');
      await user.selectOptions(categorySelect(), '餐飲');
      fireEvent.change(screen.getByLabelText('備註'), {
        target: { value: "'; DROP TABLE transactions;-- 🙂" },
      });

      await user.click(submitButton());

      await waitFor(() => expect(requestsTo('POST', '/api/transactions')).toHaveLength(1));
      expect(lastBody('POST')).toMatchObject({
        item: '<b>午餐</b>🍜',
        note: "'; DROP TABLE transactions;-- 🙂",
      });
    });
  });
});

describe('TransactionFormPage / 編輯', () => {
  describe('Happy', () => {
    it('預填：帳本、收支、項目、金額、分類、日期、備註皆為該筆紀錄的值', async () => {
      await renderEdit(11);

      expect(screen.getByRole('radio', { name: '個人' })).toBeChecked();
      expect(screen.getByRole('radio', { name: '支出' })).toBeChecked();
      expect(screen.getByLabelText('項目')).toHaveValue('晚餐');
      expect(screen.getByLabelText('金額')).toHaveValue(200);
      expect(screen.getByLabelText('日期')).toHaveValue('2026-11-12');
      expect(screen.getByLabelText('備註')).toHaveValue('和朋友');
      await waitFor(() => expect(categorySelect()).toHaveValue('1'));
    });

    it('預填收入紀錄：收支為「收入」，分類載入收入分類並選中「薪資」', async () => {
      await renderEdit(12);

      expect(screen.getByRole('radio', { name: '收入' })).toBeChecked();
      await screen.findByRole('option', { name: '薪資' });
      await waitFor(() => expect(categorySelect()).toHaveValue('3'));
      expect(categoryRequests().at(-1)?.query).toEqual({ ledger: 'personal', entryType: 'income' });
    });

    it('修改金額後送出 → PUT /api/transactions/10（全欄位）→ 回列表；ASM-14：不呼叫 closeWindow', async () => {
      liffMock.isInClient.mockReturnValue(true);
      const { user } = await renderEdit(10);
      await waitFor(() => expect(categorySelect()).toHaveValue('1'));

      await user.clear(screen.getByLabelText('金額'));
      await user.type(screen.getByLabelText('金額'), '150');
      await user.click(submitButton());

      await waitFor(() =>
        expect(screen.getByTestId('location-pathname')).toHaveTextContent(/^\/$/),
      );
      expect(requestsTo('PUT', '/api/transactions/10')).toHaveLength(1);
      expect(requestsTo('POST', '/api/transactions')).toHaveLength(0);
      expect(lastBody('PUT')).toEqual({
        ledger: 'personal',
        entryType: 'expense',
        item: '午餐',
        amount: 150,
        categoryId: 1,
        occurredOn: '2026-11-12',
        note: null,
      });
      expect(liffMock.closeWindow).not.toHaveBeenCalled();
    });

    it('編輯時改帳本：分類被清空；改選公司分類「文具」後 PUT 帶新帳本與分類', async () => {
      const { user } = await renderEdit(10);
      await waitFor(() => expect(categorySelect()).toHaveValue('1'));

      await user.click(screen.getByRole('radio', { name: '公司' }));
      await screen.findByRole('option', { name: '文具' });
      expect(categorySelect()).toHaveValue('');
      await user.selectOptions(categorySelect(), '文具');
      await user.click(submitButton());

      await waitFor(() => expect(requestsTo('PUT', '/api/transactions/10')).toHaveLength(1));
      expect(lastBody('PUT')).toMatchObject({
        ledger: 'company',
        entryType: 'expense',
        categoryId: 5,
      });
    });

    it('編輯時改帳本卻沒重選分類 → 「請選擇分類」，不送出', async () => {
      const { user } = await renderEdit(10);
      await waitFor(() => expect(categorySelect()).toHaveValue('1'));

      await user.click(screen.getByRole('radio', { name: '公司' }));
      await screen.findByRole('option', { name: '文具' });
      await user.click(submitButton());

      expect(await screen.findByText('請選擇分類')).toBeInTheDocument();
      expect(requestsTo('PUT', /\/api\/transactions\/\d+/)).toHaveLength(0);
    });
  });

  describe('Error', () => {
    it('PUT 回 CATEGORY_MISMATCH → 顯示中文訊息，輸入保留、仍在編輯頁', async () => {
      server.use(http.put('*/api/transactions/:id', () => errorResponse(400, 'CATEGORY_MISMATCH')));
      const { user } = await renderEdit(11);
      await waitFor(() => expect(categorySelect()).toHaveValue('1'));
      await user.clear(screen.getByLabelText('金額'));
      await user.type(screen.getByLabelText('金額'), '250');

      await user.click(submitButton());

      expect(await screen.findByRole('alert')).toHaveTextContent(
        '所選分類與帳本或收支不符，請重新選擇分類',
      );
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/edit/11');
      expect(screen.getByLabelText('金額')).toHaveValue(250);
      expect(screen.getByLabelText('備註')).toHaveValue('和朋友');
    });

    it('PUT 回 404（紀錄已被刪除）→ 顯示「找不到指定的資料」', async () => {
      server.use(http.put('*/api/transactions/:id', () => errorResponse(404, 'NOT_FOUND')));
      const { user } = await renderEdit(10);
      await waitFor(() => expect(categorySelect()).toHaveValue('1'));

      await user.click(submitButton());

      expect(await screen.findByRole('alert')).toHaveTextContent('找不到指定的資料');
    });

    it('網路錯誤 → 保留編輯中的輸入', async () => {
      server.use(http.put('*/api/transactions/:id', () => HttpResponse.error()));
      const { user } = await renderEdit(10);
      await waitFor(() => expect(categorySelect()).toHaveValue('1'));
      await user.clear(screen.getByLabelText('項目'));
      await user.type(screen.getByLabelText('項目'), '改過的項目');

      await user.click(submitButton());

      expect(await screen.findByRole('alert')).toHaveTextContent('網路連線失敗，請檢查網路後再試');
      expect(screen.getByLabelText('項目')).toHaveValue('改過的項目');
    });

    it('直接開啟 /edit/10（沒有 router state）→ 「找不到要編輯的紀錄」與返回列表連結，不送任何寫入請求', async () => {
      renderRoutes(routes, '/edit/10');

      expect(await screen.findByRole('alert')).toHaveTextContent('找不到要編輯的紀錄');
      expect(screen.getByRole('link', { name: '返回列表' })).toHaveAttribute('href', '/');
      expect(requestsTo('PUT', /\/api\/transactions\/\d+/)).toHaveLength(0);
      expect(requestsTo('POST', '/api/transactions')).toHaveLength(0);
    });
  });

  describe('Edge', () => {
    it('編輯頁雙擊「儲存」只發出一次 PUT', async () => {
      server.use(
        http.put('*/api/transactions/:id', async () => {
          await new Promise((r) => setTimeout(r, 50));
          return HttpResponse.json({
            id: 10,
            ledger: 'personal',
            entryType: 'expense',
            item: '午餐',
            amount: 120,
            categoryId: 1,
            categoryName: '餐飲',
            occurredOn: '2026-11-12',
            note: null,
            source: 'line_text',
          });
        }),
      );
      const { user } = await renderEdit(10);
      await waitFor(() => expect(categorySelect()).toHaveValue('1'));

      await user.dblClick(submitButton());

      await waitFor(() =>
        expect(screen.getByTestId('location-pathname')).toHaveTextContent(/^\/$/),
      );
      expect(requestsTo('PUT', '/api/transactions/10')).toHaveLength(1);
    });
  });
});
