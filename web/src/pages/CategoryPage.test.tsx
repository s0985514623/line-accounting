/**
 * CategoryPage（路由 /liff/categories → 元件內路徑 "/categories"）
 *
 * 執行：npm --prefix web test -- src/pages/CategoryPage.test.tsx
 * 對應規格：specs/features/category/{查詢分類列表,新增分類,刪除分類}.feature、specs/api/api.yml
 * 使用者決策：個人/公司分類各自一套；「其他」不可刪；刪除分類時舊紀錄改歸「其他」。
 *
 * 假設的模組介面：
 *   web/src/pages/CategoryPage.tsx   export function CategoryPage()   （具名匯出、無 props）
 *   web/src/api/categories.ts        新增 createCategory / deleteCategory / useCreateCategory / useDeleteCategory
 *                                    （介面見 api/categories.test.ts）
 *
 * 測試依賴的 accessible name / 文案（react-master 請照此實作）：
 *   - 頁面標題：heading「分類管理」
 *   - 帳本切換：radiogroup「帳本」→ radio「個人」「公司」，預設「個人」（LedgerToggle）
 *   - 收支切換：radiogroup「收支」→ radio「支出」「收入」，預設「支出」（EntryTypeToggle）
 *   - 載入中：role="status" 內含「載入中」
 *   - 分類列表：role="list"，每個分類一個 listitem，順序＝API 回傳順序（前端不重排）；
 *       分類名稱獨立於一個元素內（測試用 getByText 完整比對）；名稱一律以純文字渲染
 *   - 刪除入口：button，accessible name =「刪除{分類名}」（例如「刪除交通」）；「其他」（isFallback）列不渲染刪除鈕
 *   - 新增表單：textbox，label「分類名稱」，maxlength=50；button「新增分類」
 *       · 名稱 trim（含全形空白 U+3000）後為空 → 不送請求，role="alert" 顯示「請輸入分類名稱」
 *       · 送出的 name 為 trim 後的值；請求帶目前選中的 ledger / entryType
 *       · 成功後清空輸入框、列表重新載入；失敗時保留輸入框內容
 *       · 送出中不可重複送出（雙擊只發一次 POST）
 *   - 刪除確認：role="dialog"（name「刪除分類」），內文含分類名稱，且提示紀錄將「改歸「其他」」；
 *       按鈕「確認刪除」「取消」。確認 → DELETE /api/categories/{id}；取消 → 不發請求
 *       · 刪除成功後 invalidate ['categories'] 與 ['transactions']（紀錄已改歸「其他」）
 *   - 錯誤：role="alert"，內容為 ApiError.message（中文對照；例如 409 →「名稱重複」）
 */
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CategoryPage } from './CategoryPage';
import {
  delay,
  errorResponse,
  getMockTransactions,
  http,
  HttpResponse,
  addMockTransaction,
  requestsTo,
} from '../test/mocks/handlers';
import { server } from '../test/mocks/server';
import { renderRoutes } from '../test/render';

function renderCategories() {
  return renderRoutes([{ path: '/categories', element: <CategoryPage /> }], '/categories');
}

function names() {
  return within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((li) => li.textContent ?? '');
}

/** 等到列表載入完成（預設個人支出：餐飲、交通、其他）。 */
async function loaded() {
  await screen.findByText('餐飲');
}

/** request log 的 body 是非同步補上的，等它出現。 */
async function lastPostBody() {
  await waitFor(() => expect(requestsTo('POST', '/api/categories').at(-1)?.body).toBeDefined());
  return requestsTo('POST', '/api/categories').at(-1)?.body;
}

describe('CategoryPage', () => {
  describe('Smoke', () => {
    it('先顯示載入中，之後以預設「個人 × 支出」載入分類（一般分類在前、「其他」在最後）', async () => {
      renderCategories();

      expect(screen.getByRole('heading', { name: '分類管理' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('載入中');

      await loaded();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByRole('radio', { name: '個人' })).toBeChecked();
      expect(screen.getByRole('radio', { name: '支出' })).toBeChecked();
      expect(requestsTo('GET', '/api/categories')[0]?.query).toEqual({
        ledger: 'personal',
        entryType: 'expense',
      });
      expect(names()).toEqual([
        expect.stringContaining('餐飲'),
        expect.stringContaining('交通'),
        expect.stringContaining('其他'),
      ]);
    });
  });

  describe('Happy：「其他」不可刪', () => {
    it('一般分類有刪除鈕，「其他」沒有刪除鈕', async () => {
      renderCategories();
      await loaded();

      expect(screen.getByRole('button', { name: '刪除餐飲' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '刪除交通' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '刪除其他' })).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /^刪除/ })).toHaveLength(2);
    });

    it.each([
      ['personal', 'expense', '個人', '支出', 2],
      ['personal', 'income', '個人', '收入', 2],
      ['company', 'expense', '公司', '支出', 2],
      ['company', 'income', '公司', '收入', 1],
    ] as const)(
      '%s × %s：「其他」無刪除鈕，刪除鈕數 = 一般分類數',
      async (_ledger, _entryType, ledgerLabel, entryLabel, normalCount) => {
        const { user } = renderCategories();
        await loaded();
        await user.click(screen.getByRole('radio', { name: ledgerLabel }));
        await user.click(screen.getByRole('radio', { name: entryLabel }));

        await waitFor(() => {
          const last = requestsTo('GET', '/api/categories').at(-1)?.query;
          expect(last).toEqual({ ledger: _ledger, entryType: _entryType });
        });
        await screen.findByText('其他');
        await waitFor(() =>
          expect(screen.getAllByRole('button', { name: /^刪除/ })).toHaveLength(normalCount),
        );
        expect(screen.queryByRole('button', { name: '刪除其他' })).not.toBeInTheDocument();
      },
    );
  });

  describe('Happy：帳本與收支切換', () => {
    it('切換到公司 → 以 company × expense 重新查詢，只顯示公司支出分類', async () => {
      const { user } = renderCategories();
      await loaded();

      await user.click(screen.getByRole('radio', { name: '公司' }));

      expect(await screen.findByText('文具')).toBeInTheDocument();
      expect(screen.getByText('差旅')).toBeInTheDocument();
      expect(screen.queryByText('餐飲')).not.toBeInTheDocument();
      expect(requestsTo('GET', '/api/categories').at(-1)?.query).toEqual({
        ledger: 'company',
        entryType: 'expense',
      });
    });

    it('切換到收入 → 以 personal × income 重新查詢，只顯示個人收入分類', async () => {
      const { user } = renderCategories();
      await loaded();

      await user.click(screen.getByRole('radio', { name: '收入' }));

      expect(await screen.findByText('薪資')).toBeInTheDocument();
      expect(screen.getByText('獎金')).toBeInTheDocument();
      expect(screen.queryByText('餐飲')).not.toBeInTheDocument();
      expect(requestsTo('GET', '/api/categories').at(-1)?.query).toEqual({
        ledger: 'personal',
        entryType: 'income',
      });
    });

    it('在公司帳本新增分類：POST 帶 ledger=company、entryType=expense', async () => {
      const { user } = renderCategories();
      await loaded();
      await user.click(screen.getByRole('radio', { name: '公司' }));
      await screen.findByText('文具');

      await user.type(screen.getByRole('textbox', { name: '分類名稱' }), '雜項');
      await user.click(screen.getByRole('button', { name: '新增分類' }));

      expect(await screen.findByText('雜項')).toBeInTheDocument();
      expect(await lastPostBody()).toEqual({
        ledger: 'company',
        entryType: 'expense',
        name: '雜項',
      });
    });
  });

  describe('Happy：新增分類', () => {
    it('輸入名稱送出 → POST（name 已 trim）→ 清空輸入框，新分類出現在「其他」之前', async () => {
      const { user } = renderCategories();
      await loaded();
      const input = screen.getByRole('textbox', { name: '分類名稱' });

      await user.type(input, '  寵物  ');
      await user.click(screen.getByRole('button', { name: '新增分類' }));

      expect(await screen.findByText('寵物')).toBeInTheDocument();
      expect(await lastPostBody()).toEqual({
        ledger: 'personal',
        entryType: 'expense',
        name: '寵物',
      });
      expect(input).toHaveValue('');
      const list = names();
      expect(list.at(-1)).toContain('其他');
      expect(list.findIndex((t) => t.includes('寵物'))).toBe(list.length - 2);
      expect(screen.getByRole('button', { name: '刪除寵物' })).toBeInTheDocument();
    });

    it('按 Enter 也能送出（表單 submit）', async () => {
      const { user } = renderCategories();
      await loaded();

      await user.type(screen.getByRole('textbox', { name: '分類名稱' }), '寵物{Enter}');

      expect(await screen.findByText('寵物')).toBeInTheDocument();
      expect(requestsTo('POST', '/api/categories')).toHaveLength(1);
    });

    it('不同收支可同名：在「收入」新增「餐飲」成功', async () => {
      const { user } = renderCategories();
      await loaded();
      await user.click(screen.getByRole('radio', { name: '收入' }));
      await screen.findByText('薪資');

      await user.type(screen.getByRole('textbox', { name: '分類名稱' }), '餐飲');
      await user.click(screen.getByRole('button', { name: '新增分類' }));

      expect(await screen.findByRole('button', { name: '刪除餐飲' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('Error：新增分類', () => {
    it.each([
      ['空字串', ''],
      ['半形空白', '   '],
      ['全形空白', '　　'],
    ])('名稱為%s → 阻擋送出，不發 POST，顯示「請輸入分類名稱」', async (_label, value) => {
      const { user } = renderCategories();
      await loaded();
      if (value) await user.type(screen.getByRole('textbox', { name: '分類名稱' }), value);

      await user.click(screen.getByRole('button', { name: '新增分類' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('請輸入分類名稱');
      expect(requestsTo('POST', '/api/categories')).toHaveLength(0);
      expect(names()).toHaveLength(3);
    });

    it('409 DUPLICATE_NAME → 顯示「名稱重複」，保留輸入內容，列表不變', async () => {
      const { user } = renderCategories();
      await loaded();
      const input = screen.getByRole('textbox', { name: '分類名稱' });

      await user.type(input, '餐飲');
      await user.click(screen.getByRole('button', { name: '新增分類' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('名稱重複');
      expect(input).toHaveValue('餐飲');
      expect(names()).toHaveLength(3);
      expect(requestsTo('POST', '/api/categories')).toHaveLength(1);
    });

    it('名稱與「其他」相同（同帳本同收支）同樣視為重複', async () => {
      const { user } = renderCategories();
      await loaded();

      await user.type(screen.getByRole('textbox', { name: '分類名稱' }), '其他');
      await user.click(screen.getByRole('button', { name: '新增分類' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('名稱重複');
    });

    it('網路中斷 → 顯示網路錯誤訊息並保留輸入', async () => {
      server.use(http.post('*/api/categories', () => HttpResponse.error()));
      const { user } = renderCategories();
      await loaded();
      const input = screen.getByRole('textbox', { name: '分類名稱' });

      await user.type(input, '寵物');
      await user.click(screen.getByRole('button', { name: '新增分類' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('網路連線失敗，請檢查網路後再試');
      expect(input).toHaveValue('寵物');
    });

    it('伺服器 400 INVALID_ARGUMENT → 顯示中文訊息（不顯示伺服器原文）', async () => {
      server.use(http.post('*/api/categories', () => errorResponse(400, 'INVALID_ARGUMENT')));
      const { user } = renderCategories();
      await loaded();

      await user.type(screen.getByRole('textbox', { name: '分類名稱' }), '寵物');
      await user.click(screen.getByRole('button', { name: '新增分類' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('輸入的資料有誤，請檢查後再試');
      expect(alert).not.toHaveTextContent('server says');
    });
  });

  describe('Edge：新增分類', () => {
    it('輸入框 maxlength 為 50（api.yml CategoryInput.name maxLength）', async () => {
      renderCategories();
      await loaded();

      expect(screen.getByRole('textbox', { name: '分類名稱' })).toHaveAttribute('maxlength', '50');
    });

    it('名稱中間的空白保留、前後空白移除；Emoji 與 Unicode 原樣送出', async () => {
      const { user } = renderCategories();
      await loaded();

      await user.click(screen.getByRole('textbox', { name: '分類名稱' }));
      await user.paste(' 🐶 寵物 用品 ');
      await user.click(screen.getByRole('button', { name: '新增分類' }));

      expect(await lastPostBody()).toEqual({
        ledger: 'personal',
        entryType: 'expense',
        name: '🐶 寵物 用品',
      });
    });

    it('雙擊「新增分類」只發出一次 POST', async () => {
      server.use(
        http.post('*/api/categories', async () => {
          await delay(50);
          return HttpResponse.json(
            { id: 300, ledger: 'personal', entryType: 'expense', name: '寵物', isFallback: false },
            { status: 201 },
          );
        }),
      );
      const { user } = renderCategories();
      await loaded();

      await user.type(screen.getByRole('textbox', { name: '分類名稱' }), '寵物');
      await user.dblClick(screen.getByRole('button', { name: '新增分類' }));

      await waitFor(() => expect(screen.getByRole('textbox', { name: '分類名稱' })).toHaveValue(''));
      expect(requestsTo('POST', '/api/categories')).toHaveLength(1);
    });
  });

  describe('Happy：刪除分類', () => {
    it('按「刪除」→ 開啟確認對話框，含分類名稱與「改歸「其他」」提示；此時尚未發 DELETE', async () => {
      const { user } = renderCategories();
      await loaded();

      await user.click(screen.getByRole('button', { name: '刪除交通' }));

      const dialog = screen.getByRole('dialog', { name: '刪除分類' });
      expect(dialog).toHaveTextContent('交通');
      expect(dialog).toHaveTextContent('改歸「其他」');
      expect(within(dialog).getByRole('button', { name: '確認刪除' })).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: '取消' })).toBeInTheDocument();
      expect(requestsTo('DELETE', /\/api\/categories\//)).toHaveLength(0);
    });

    it('取消 → 對話框關閉、不發 DELETE、列表不變', async () => {
      const { user } = renderCategories();
      await loaded();
      await user.click(screen.getByRole('button', { name: '刪除交通' }));

      await user.click(screen.getByRole('button', { name: '取消' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(requestsTo('DELETE', /\/api\/categories\//)).toHaveLength(0);
      expect(screen.getByText('交通')).toBeInTheDocument();
    });

    it('確認刪除 → DELETE /api/categories/{id}、對話框關閉、列表移除該分類', async () => {
      const { user } = renderCategories();
      await loaded();
      await user.click(screen.getByRole('button', { name: '刪除交通' }));

      await user.click(screen.getByRole('button', { name: '確認刪除' }));

      await waitFor(() => expect(screen.queryByText('交通')).not.toBeInTheDocument());
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(requestsTo('DELETE', '/api/categories/2')).toHaveLength(1);
      expect(screen.getByText('餐飲')).toBeInTheDocument();
      expect(screen.getByText('其他')).toBeInTheDocument();
    });

    it('刪除後 invalidate 分類與記帳列表快取（舊紀錄已改歸「其他」）', async () => {
      const { user, queryClient } = renderCategories();
      await loaded();
      const spy = vi.spyOn(queryClient, 'invalidateQueries');
      await user.click(screen.getByRole('button', { name: '刪除交通' }));

      await user.click(screen.getByRole('button', { name: '確認刪除' }));

      await waitFor(() => expect(screen.queryByText('交通')).not.toBeInTheDocument());
      const keys = spy.mock.calls.map(([filters]) => filters?.queryKey);
      expect(keys).toContainEqual(['categories']);
      expect(keys).toContainEqual(['transactions']);
    });

    it('（整合）被刪分類底下的紀錄改歸同帳本同收支的「其他」', async () => {
      addMockTransaction({
        id: 201,
        ledger: 'personal',
        entryType: 'expense',
        item: '捷運',
        amount: 30,
        categoryId: 2,
        categoryName: '交通',
        occurredOn: '2026-11-04',
        note: null,
        source: 'line_text',
      });
      const { user } = renderCategories();
      await loaded();

      await user.click(screen.getByRole('button', { name: '刪除交通' }));
      await user.click(screen.getByRole('button', { name: '確認刪除' }));

      await waitFor(() => expect(screen.queryByText('交通')).not.toBeInTheDocument());
      expect(getMockTransactions().find((t) => t.id === 201)).toMatchObject({
        categoryId: 7,
        categoryName: '其他',
      });
    });

    it('對話框在刪除進行中不可重複確認（雙擊只發一次 DELETE）', async () => {
      server.use(
        http.delete('*/api/categories/:id', async () => {
          await delay(50);
          return new HttpResponse(null, { status: 204 });
        }),
      );
      const { user } = renderCategories();
      await loaded();
      await user.click(screen.getByRole('button', { name: '刪除交通' }));

      await user.dblClick(screen.getByRole('button', { name: '確認刪除' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(requestsTo('DELETE', /\/api\/categories\//)).toHaveLength(1);
    });
  });

  describe('Error：刪除分類與載入', () => {
    it('404 NOT_FOUND（分類已被刪）→ 顯示「找不到指定的資料」', async () => {
      server.use(http.delete('*/api/categories/:id', () => errorResponse(404, 'NOT_FOUND')));
      const { user } = renderCategories();
      await loaded();
      await user.click(screen.getByRole('button', { name: '刪除交通' }));

      await user.click(screen.getByRole('button', { name: '確認刪除' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('找不到指定的資料');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('422 FALLBACK_CATEGORY_UNDELETABLE（防禦）→ 顯示「「其他」分類無法刪除」', async () => {
      server.use(
        http.delete('*/api/categories/:id', () => errorResponse(422, 'FALLBACK_CATEGORY_UNDELETABLE')),
      );
      const { user } = renderCategories();
      await loaded();
      await user.click(screen.getByRole('button', { name: '刪除交通' }));

      await user.click(screen.getByRole('button', { name: '確認刪除' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('「其他」分類無法刪除');
    });

    it('載入分類失敗（500）→ 顯示錯誤訊息，不顯示列表', async () => {
      server.use(http.get('*/api/categories', () => HttpResponse.json({}, { status: 500 })));
      renderCategories();

      expect(await screen.findByRole('alert')).toHaveTextContent('伺服器發生錯誤，請稍後再試');
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('載入分類 403 → 顯示無權限訊息', async () => {
      server.use(http.get('*/api/categories', () => errorResponse(403, 'FORBIDDEN')));
      renderCategories();

      expect(await screen.findByRole('alert')).toHaveTextContent('您沒有使用此服務的權限');
    });
  });

  describe('Security', () => {
    it('分類名稱含 HTML / script 字串時以純文字顯示，不產生元素', async () => {
      const evil = '<img src=x onerror=alert(1)>';
      server.use(
        http.get('*/api/categories', () =>
          HttpResponse.json({
            items: [
              { id: 50, ledger: 'personal', entryType: 'expense', name: evil, isFallback: false },
              { id: 51, ledger: 'personal', entryType: 'expense', name: '其他', isFallback: true },
            ],
          }),
        ),
      );
      const { container } = renderCategories();

      expect(await screen.findByText(evil)).toBeInTheDocument();
      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByRole('button', { name: `刪除${evil}` })).toBeInTheDocument();
    });

    it('刪除確認對話框中的分類名稱同樣以純文字顯示', async () => {
      const evil = '<b>粗體</b>';
      server.use(
        http.get('*/api/categories', () =>
          HttpResponse.json({
            items: [
              { id: 50, ledger: 'personal', entryType: 'expense', name: evil, isFallback: false },
              { id: 51, ledger: 'personal', entryType: 'expense', name: '其他', isFallback: true },
            ],
          }),
        ),
      );
      const { user } = renderCategories();
      await screen.findByText(evil);

      await user.click(screen.getByRole('button', { name: `刪除${evil}` }));

      const dialog = screen.getByRole('dialog', { name: '刪除分類' });
      expect(dialog.querySelector('b')).toBeNull();
      expect(dialog).toHaveTextContent(evil);
    });
  });
});
