/**
 * 分類 API client 的「新增 / 刪除」（查詢已由既有頁面測試間接涵蓋）。
 *
 * 執行：npm --prefix web test -- src/api/categories.test.ts
 * 對應規格：specs/features/category/新增分類.feature、刪除分類.feature、specs/api/api.yml
 *
 * 假設的模組介面（web/src/api/categories.ts，新增匯出）：
 *   createCategory(input: { ledger: TLedger; entryType: TEntryType; name: string }): Promise<TCategory>
 *     - POST /api/categories，body 即 input（client 層不 trim；trim 由頁面負責）
 *     - 201 以 categorySchema 解析
 *   deleteCategory(id: number): Promise<void>
 *     - DELETE /api/categories/{id}，204 回傳 undefined
 *   useCreateCategory() / useDeleteCategory()
 *     - useMutation；成功後 invalidate CATEGORIES_QUERY_KEY
 *     - useDeleteCategory 成功後另 invalidate TRANSACTIONS_QUERY_KEY（紀錄已改歸「其他」，列表需重載）
 */
import { describe, expect, it } from 'vitest';
import { createCategory, deleteCategory, fetchCategories } from './categories';
import { ApiError } from './http';
import {
  errorResponse,
  http,
  HttpResponse,
  requestsTo,
  VALID_ID_TOKEN,
} from '../test/mocks/handlers';
import { server } from '../test/mocks/server';

async function catchError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('預期應該失敗，但成功了');
}

/** request log 的 body 是非同步補上的，稍等一下再讀。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('api/categories / createCategory', () => {
  it('Happy：POST 帶 ledger / entryType / name 與 Bearer token，回傳 isFallback=false 的新分類', async () => {
    const created = await createCategory({ ledger: 'personal', entryType: 'expense', name: '寵物' });

    expect(created).toMatchObject({
      ledger: 'personal',
      entryType: 'expense',
      name: '寵物',
      isFallback: false,
    });
    expect(typeof created.id).toBe('number');
    await settle();
    const [req] = requestsTo('POST', '/api/categories');
    expect(req?.body).toEqual({ ledger: 'personal', entryType: 'expense', name: '寵物' });
    expect(req?.authorization).toBe(`Bearer ${VALID_ID_TOKEN}`);
  });

  it('Happy：不同帳本或收支可同名（公司支出「餐飲」、個人收入「餐飲」皆成功）', async () => {
    await expect(
      createCategory({ ledger: 'company', entryType: 'expense', name: '餐飲' }),
    ).resolves.toMatchObject({ name: '餐飲', ledger: 'company' });
    await expect(
      createCategory({ ledger: 'personal', entryType: 'income', name: '餐飲' }),
    ).resolves.toMatchObject({ name: '餐飲', entryType: 'income' });
  });

  it('Happy：新增後查詢，新分類排在「其他」之前', async () => {
    await createCategory({ ledger: 'personal', entryType: 'expense', name: '寵物' });

    const names = (await fetchCategories('personal', 'expense')).map((c) => c.name);
    expect(names).toEqual(['餐飲', '交通', '寵物', '其他']);
  });

  it('Error：409 DUPLICATE_NAME → 「名稱重複」', async () => {
    const error = await catchError(
      createCategory({ ledger: 'personal', entryType: 'expense', name: '餐飲' }),
    );

    expect(error.status).toBe(409);
    expect(error.violationType).toBe('DUPLICATE_NAME');
    expect(error.message).toBe('名稱重複');
  });

  it('Error：400 INVALID_ARGUMENT（伺服器端把關空白名稱）', async () => {
    const error = await catchError(
      createCategory({ ledger: 'personal', entryType: 'expense', name: '  ' }),
    );

    expect(error.violationType).toBe('INVALID_ARGUMENT');
  });

  it('Error：回應缺 isFallback → INVALID_RESPONSE', async () => {
    server.use(
      http.post('*/api/categories', () =>
        HttpResponse.json(
          { id: 1, ledger: 'personal', entryType: 'expense', name: '寵物' },
          { status: 201 },
        ),
      ),
    );

    const error = await catchError(
      createCategory({ ledger: 'personal', entryType: 'expense', name: '寵物' }),
    );

    expect(error.violationType).toBe('INVALID_RESPONSE');
  });
});

describe('api/categories / deleteCategory', () => {
  it('Happy：DELETE /api/categories/{id}，204 回傳 undefined', async () => {
    await expect(deleteCategory(2)).resolves.toBeUndefined();

    expect(requestsTo('DELETE', '/api/categories/2')).toHaveLength(1);
    const names = (await fetchCategories('personal', 'expense')).map((c) => c.name);
    expect(names).toEqual(['餐飲', '其他']);
  });

  it('Error：刪除「其他」→ 422 FALLBACK_CATEGORY_UNDELETABLE', async () => {
    const error = await catchError(deleteCategory(7));

    expect(error.status).toBe(422);
    expect(error.violationType).toBe('FALLBACK_CATEGORY_UNDELETABLE');
    expect(error.message).toBe('「其他」分類無法刪除');
  });

  it('Error：不存在的分類 → 404 NOT_FOUND', async () => {
    const error = await catchError(deleteCategory(999));

    expect(error.violationType).toBe('NOT_FOUND');
    expect(error.message).toBe('找不到指定的資料');
  });

  it('Error：403 FORBIDDEN', async () => {
    server.use(http.delete('*/api/categories/:id', () => errorResponse(403, 'FORBIDDEN')));

    const error = await catchError(deleteCategory(2));

    expect(error.violationType).toBe('FORBIDDEN');
  });
});
