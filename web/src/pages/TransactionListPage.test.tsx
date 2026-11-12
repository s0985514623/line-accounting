/**
 * TransactionListPage（路由 /liff/ → 元件內路徑 "/"）
 *
 * 執行：npm --prefix web test -- src/pages/TransactionListPage.test.tsx
 * 對應規格：specs/features/transaction/查詢記帳紀錄列表.feature、刪除記帳紀錄.feature
 *
 * 假設的模組介面：
 *   web/src/pages/TransactionListPage.tsx   export function TransactionListPage()   （具名匯出、無 props）
 *   - 內部使用 react-router（<Link>/useNavigate）與 TanStack Query（由外層 Provider 提供）
 *
 * 測試依賴的 accessible name / 文案（react-master 請照此實作）：
 *   - 頁面標題：heading「記帳紀錄」
 *   - 月份選擇：<input type="month">，label「月份」，預設值 = 今天（Asia/Taipei）所屬月份 YYYY-MM
 *   - 帳本切換：radio「個人」「公司」（radiogroup「帳本」），預設「個人」
 *   - 載入中：role="status" 內含「載入中」
 *   - 列表：role="list"（<ul>），每筆紀錄一個 listitem，順序＝API 回傳順序（前端不重排）
 *       · 編輯入口：role="link"，accessible name 含項目名稱，導向 /edit/{id}，並以 router state 帶入 { transaction }
 *       · 刪除入口：button，accessible name =「刪除{項目}」（例如「刪除午餐」）
 *       · 列內需顯示：項目、金額（允許千分位）、備註（若有）；項目名稱與備註各自獨立於一個元素內（測試用 getByText 完整比對）
 *   - 空狀態：文字「本月尚無紀錄」
 *   - 錯誤：role="alert"，內容為 ApiError.message（中文對照）
 *   - 新增入口：link「新增記帳」→ /new
 *   - 刪除確認：role="dialog"（name「刪除記帳紀錄」），內含項目名稱；按鈕「確認刪除」「取消」
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionListPage } from './TransactionListPage';
import {
  addMockTransaction,
  errorResponse,
  http,
  HttpResponse,
  requestsTo,
  VALID_ID_TOKEN,
} from '../test/mocks/handlers';
import { liffMock } from '../test/mocks/liff';
import { server } from '../test/mocks/server';
import { renderRoutes } from '../test/render';
import { useLocation } from 'react-router';

/** 2026-11-12 12:00（Asia/Taipei）＝ 04:00Z，與 BDD 的固定時鐘一致 */
function freezeNow(iso = '2026-11-12T04:00:00Z') {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

function EditProbe() {
  const location = useLocation();
  const state = location.state as { transaction?: { id: number; item: string } } | null;
  return (
    <div data-testid="edit-probe">
      {state?.transaction ? `${state.transaction.id}:${state.transaction.item}` : 'no-state'}
    </div>
  );
}

function renderList() {
  return renderRoutes(
    [
      { path: '/', element: <TransactionListPage /> },
      { path: '/new', element: <div>新增頁</div> },
      { path: '/edit/:id', element: <EditProbe /> },
    ],
    '/',
  );
}

function itemsInList() {
  return within(screen.getByRole('list')).getAllByRole('listitem');
}

beforeEach(() => {
  freezeNow();
});

describe('TransactionListPage', () => {
  describe('Smoke', () => {
    it('先顯示載入中，之後依月份與帳本載入列表，請求帶 Bearer ID token', async () => {
      renderList();

      expect(screen.getByRole('heading', { name: '記帳紀錄' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('載入中');

      expect(await screen.findByText('午餐')).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      const [req] = requestsTo('GET', '/api/transactions');
      expect(req?.query).toEqual({ month: '2026-11', ledger: 'personal' });
      expect(req?.authorization).toBe(`Bearer ${VALID_ID_TOKEN}`);
    });
  });

  describe('Happy', () => {
    it('預設為本月（Asia/Taipei）與個人帳本，控制項顯示目前值', async () => {
      renderList();
      await screen.findByText('午餐');

      expect(screen.getByLabelText('月份')).toHaveValue('2026-11');
      expect(screen.getByRole('radio', { name: '個人' })).toBeChecked();
      expect(screen.getByRole('radio', { name: '公司' })).not.toBeChecked();
    });

    it('列表依 API 順序顯示（日期新到舊、同日 id 大到小），並顯示金額與備註', async () => {
      renderList();
      await screen.findByText('午餐');

      const rows = itemsInList();
      expect(rows).toHaveLength(3);
      expect(rows[0]).toHaveTextContent('晚餐');
      expect(rows[0]).toHaveTextContent('200');
      expect(rows[0]).toHaveTextContent('和朋友');
      expect(rows[1]).toHaveTextContent('午餐');
      expect(rows[1]).toHaveTextContent('120');
      expect(rows[2]).toHaveTextContent('薪資');
      expect(rows[2]).toHaveTextContent(/50,?000/);
    });

    it('切換月份 → 以新月份重新查詢，只顯示該月紀錄', async () => {
      renderList();
      await screen.findByText('午餐');

      fireEvent.change(screen.getByLabelText('月份'), { target: { value: '2026-10' } });

      expect(await screen.findByText('宵夜')).toBeInTheDocument();
      expect(screen.queryByText('午餐')).not.toBeInTheDocument();
      expect(requestsTo('GET', '/api/transactions').at(-1)?.query).toEqual({
        month: '2026-10',
        ledger: 'personal',
      });
    });

    it('切換帳本 → 以新帳本重新查詢，只顯示該帳本紀錄', async () => {
      const { user } = renderList();
      await screen.findByText('午餐');

      await user.click(screen.getByRole('radio', { name: '公司' }));

      expect(await screen.findByText('影印紙')).toBeInTheDocument();
      expect(screen.queryByText('午餐')).not.toBeInTheDocument();
      expect(requestsTo('GET', '/api/transactions').at(-1)?.query).toEqual({
        month: '2026-11',
        ledger: 'company',
      });
    });

    it('月份與帳本同時切換，查詢參數同時反映兩者', async () => {
      const { user } = renderList();
      await screen.findByText('午餐');

      await user.click(screen.getByRole('radio', { name: '公司' }));
      fireEvent.change(screen.getByLabelText('月份'), { target: { value: '2026-10' } });

      await waitFor(() =>
        expect(requestsTo('GET', '/api/transactions').at(-1)?.query).toEqual({
          month: '2026-10',
          ledger: 'company',
        }),
      );
      expect(await screen.findByText('本月尚無紀錄')).toBeInTheDocument();
    });

    it('點擊列的編輯入口 → 導向 /edit/{id}，並以 router state 帶入該筆紀錄', async () => {
      const { user } = renderList();
      await screen.findByText('午餐');

      await user.click(screen.getByRole('link', { name: /午餐/ }));

      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/edit/10');
      expect(screen.getByTestId('edit-probe')).toHaveTextContent('10:午餐');
    });

    it('「新增記帳」連結導向 /new', async () => {
      const { user } = renderList();
      await screen.findByText('午餐');

      await user.click(screen.getByRole('link', { name: '新增記帳' }));

      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/new');
    });
  });

  describe('空狀態', () => {
    it('該月該帳本沒有紀錄 → 顯示「本月尚無紀錄」，且沒有任何列', async () => {
      server.use(http.get('*/api/transactions', () => HttpResponse.json({ items: [] })));
      renderList();

      expect(await screen.findByText('本月尚無紀錄')).toBeInTheDocument();
      expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('Error', () => {
    it('403 → 顯示中文錯誤訊息（role=alert），不顯示空狀態', async () => {
      server.use(http.get('*/api/transactions', () => errorResponse(403, 'FORBIDDEN')));
      renderList();

      expect(await screen.findByRole('alert')).toHaveTextContent('您沒有使用此服務的權限');
      expect(screen.queryByText('本月尚無紀錄')).not.toBeInTheDocument();
    });

    it('網路錯誤 → 顯示「網路連線失敗，請檢查網路後再試」', async () => {
      server.use(http.get('*/api/transactions', () => HttpResponse.error()));
      renderList();

      expect(await screen.findByRole('alert')).toHaveTextContent('網路連線失敗，請檢查網路後再試');
    });

    it('401（ID token 過期）→ 呼叫 liff.login 後以新 token 重試，最終顯示列表', async () => {
      let token = 'expired-token';
      liffMock.getIDToken.mockImplementation(() => token);
      liffMock.login.mockImplementation(() => {
        token = VALID_ID_TOKEN;
      });
      renderList();

      expect(await screen.findByText('午餐')).toBeInTheDocument();
      expect(liffMock.login).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('刪除（前端自行確認；刪除記帳紀錄.feature）', () => {
    it('點擊刪除只會開啟確認對話框，尚未呼叫 DELETE；按「取消」關閉且紀錄仍在', async () => {
      const { user } = renderList();
      await screen.findByText('午餐');

      await user.click(screen.getByRole('button', { name: '刪除午餐' }));

      const dialog = await screen.findByRole('dialog', { name: '刪除記帳紀錄' });
      expect(dialog).toHaveTextContent('午餐');
      expect(requestsTo('DELETE', /\/api\/transactions\/\d+/)).toHaveLength(0);

      await user.click(within(dialog).getByRole('button', { name: '取消' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(requestsTo('DELETE', /\/api\/transactions\/\d+/)).toHaveLength(0);
      expect(screen.getByText('午餐')).toBeInTheDocument();
    });

    it('在對話框按「確認刪除」→ DELETE /api/transactions/10 一次 → 對話框關閉並重新載入列表', async () => {
      const { user } = renderList();
      await screen.findByText('午餐');
      const listCallsBefore = requestsTo('GET', '/api/transactions').length;

      await user.click(screen.getByRole('button', { name: '刪除午餐' }));
      const dialog = await screen.findByRole('dialog', { name: '刪除記帳紀錄' });
      await user.click(within(dialog).getByRole('button', { name: '確認刪除' }));

      await waitFor(() => expect(screen.queryByText('午餐')).not.toBeInTheDocument());
      expect(requestsTo('DELETE', /\/api\/transactions\/\d+/).map((r) => r.pathname)).toEqual([
        '/api/transactions/10',
      ]);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(requestsTo('GET', '/api/transactions').length).toBeGreaterThan(listCallsBefore);
      expect(screen.getByText('晚餐')).toBeInTheDocument();
    });

    it('連點「確認刪除」兩次只送出一次 DELETE', async () => {
      server.use(
        http.delete('*/api/transactions/:id', async () => {
          await new Promise((r) => setTimeout(r, 50));
          return new HttpResponse(null, { status: 204 });
        }),
      );
      const { user } = renderList();
      await screen.findByText('午餐');

      await user.click(screen.getByRole('button', { name: '刪除午餐' }));
      const dialog = await screen.findByRole('dialog', { name: '刪除記帳紀錄' });
      await user.dblClick(within(dialog).getByRole('button', { name: '確認刪除' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(requestsTo('DELETE', /\/api\/transactions\/\d+/)).toHaveLength(1);
    });

    it('DELETE 回 404 → 顯示「找不到指定的資料」錯誤', async () => {
      server.use(http.delete('*/api/transactions/:id', () => errorResponse(404, 'NOT_FOUND')));
      const { user } = renderList();
      await screen.findByText('午餐');

      await user.click(screen.getByRole('button', { name: '刪除午餐' }));
      const dialog = await screen.findByRole('dialog', { name: '刪除記帳紀錄' });
      await user.click(within(dialog).getByRole('button', { name: '確認刪除' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('找不到指定的資料');
    });
  });

  describe('Edge', () => {
    it('Asia/Taipei 午夜邊界：UTC 11/30 16:30 已是台北 12/01 → 預設月份為 2026-12', async () => {
      freezeNow('2026-11-30T16:30:00Z');
      renderList();

      expect(await screen.findByText('本月尚無紀錄')).toBeInTheDocument();
      expect(screen.getByLabelText('月份')).toHaveValue('2026-12');
      expect(requestsTo('GET', '/api/transactions')[0]?.query.month).toBe('2026-12');
    });

    it('Asia/Taipei 年底邊界：UTC 12/31 16:00 已是台北 2027-01-01 → 預設月份為 2027-01', async () => {
      freezeNow('2026-12-31T16:00:00Z');
      renderList();

      await screen.findByText('本月尚無紀錄');
      expect(requestsTo('GET', '/api/transactions')[0]?.query.month).toBe('2027-01');
    });

    it('邊界：台北 11/30 23:59（UTC 15:59）仍屬 2026-11', async () => {
      freezeNow('2026-11-30T15:59:59Z');
      renderList();

      await screen.findByText('午餐');
      expect(requestsTo('GET', '/api/transactions')[0]?.query.month).toBe('2026-11');
    });
  });

  describe('Security', () => {
    it('項目與備註含 HTML 時以純文字顯示，不會產生元素（XSS）', async () => {
      addMockTransaction({
        id: 50,
        ledger: 'personal',
        entryType: 'expense',
        item: '<img src=x onerror=alert(1)>',
        amount: 10,
        categoryId: 1,
        categoryName: '餐飲',
        occurredOn: '2026-11-12',
        note: '<script>alert(1)</script>',
        source: 'liff_form',
      });
      const { container } = renderList();

      expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
      expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('script')).toBeNull();
    });
  });

  describe('Edge：極端資料', () => {
    it('Emoji 項目、50 字項目與最大金額 99,999,999 都能顯示', async () => {
      const longItem = '長'.repeat(50);
      addMockTransaction({
        id: 51,
        ledger: 'personal',
        entryType: 'expense',
        item: '拉麵🍜',
        amount: 99_999_999,
        categoryId: 1,
        categoryName: '餐飲',
        occurredOn: '2026-11-12',
        note: null,
        source: 'liff_form',
      });
      addMockTransaction({
        id: 52,
        ledger: 'personal',
        entryType: 'expense',
        item: longItem,
        amount: 1,
        categoryId: 1,
        categoryName: '餐飲',
        occurredOn: '2026-11-12',
        note: null,
        source: 'liff_form',
      });
      renderList();

      expect(await screen.findByText('拉麵🍜')).toBeInTheDocument();
      expect(screen.getByText(longItem)).toBeInTheDocument();
      expect(screen.getByText(/99,?999,?999/)).toBeInTheDocument();
    });
  });
});
