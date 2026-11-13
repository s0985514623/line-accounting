/**
 * BatchFormPage（/liff/batch → 元件內路徑 "/batch"）
 *
 * 執行：npm --prefix web test -- src/pages/BatchFormPage.test.tsx
 * 對應規格：specs/features/transaction/以表單批次記帳.feature
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BatchFormPage } from './BatchFormPage';
import { errorResponse, http, requestsTo } from '../test/mocks/handlers';
import { server } from '../test/mocks/server';
import { renderRoutes } from '../test/render';

const routes = [
  { path: '/batch', element: <BatchFormPage /> },
  { path: '/', element: <div>列表頁</div> },
];

function freezeNow(iso = '2026-11-12T04:00:00Z') {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

async function renderBatch() {
  const utils = renderRoutes(routes, '/batch');
  await screen.findAllByRole('option', { name: '餐飲' });
  return utils;
}

const lastBatchBody = () =>
  requestsTo('POST', '/api/transactions/batch').at(-1)?.body as
    { items: Record<string, unknown>[] } | undefined;

describe('BatchFormPage', () => {
  it('預設 3 筆，日期為今天（Asia/Taipei）', async () => {
    freezeNow();
    await renderBatch();
    expect(screen.getByRole('heading', { name: '批次記帳' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByLabelText('日期 1')).toHaveValue('2026-11-12');
    expect(screen.getByRole('button', { name: '儲存 0 筆' })).toBeInTheDocument();
  });

  it('逐筆選分類後送出，略過空白筆，成功回列表', async () => {
    freezeNow();
    const { user } = await renderBatch();

    await user.type(screen.getByLabelText('項目 1'), '午餐');
    await user.type(screen.getByLabelText('金額 1'), '120');
    await user.selectOptions(screen.getByLabelText('分類 1'), '餐飲');

    await user.type(screen.getByLabelText('項目 2'), '計程車');
    await user.type(screen.getByLabelText('金額 2'), '250');
    await user.selectOptions(screen.getByLabelText('分類 2'), '交通');
    fireEvent.change(screen.getByLabelText('日期 2'), { target: { value: '2026-10-31' } });
    await user.type(screen.getByLabelText('備註 2'), '機場');

    await user.click(screen.getByRole('button', { name: '儲存 2 筆' }));

    await waitFor(() => expect(screen.getByText('列表頁')).toBeInTheDocument());
    expect(lastBatchBody()).toEqual({
      items: [
        {
          ledger: 'personal',
          entryType: 'expense',
          item: '午餐',
          amount: 120,
          categoryId: 1,
          occurredOn: '2026-11-12',
          note: null,
        },
        {
          ledger: 'personal',
          entryType: 'expense',
          item: '計程車',
          amount: 250,
          categoryId: 2,
          occurredOn: '2026-10-31',
          note: '機場',
        },
      ],
    });
  });

  it('改預設日期：仍是舊預設值的筆一起改，個別改過的不動', async () => {
    freezeNow();
    await renderBatch();
    fireEvent.change(screen.getByLabelText('日期 2'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('預設日期'), { target: { value: '2026-11-05' } });

    expect(screen.getByLabelText('日期 1')).toHaveValue('2026-11-05');
    expect(screen.getByLabelText('日期 2')).toHaveValue('2026-11-01');
    expect(screen.getByLabelText('日期 3')).toHaveValue('2026-11-05');
  });

  it('項目與分類同名時自動選分類', async () => {
    const { user } = await renderBatch();
    await user.type(screen.getByLabelText('項目 1'), '餐飲');
    await user.tab();
    expect(screen.getByLabelText('分類 1')).toHaveValue('1');
  });

  it('驗證失敗時逐筆顯示錯誤且不送出', async () => {
    const { user } = await renderBatch();
    await user.type(screen.getByLabelText('項目 1'), '午餐');
    await user.type(screen.getByLabelText('金額 2'), '50');
    await user.click(screen.getByRole('button', { name: /儲存/ }));

    const first = screen.getByRole('listitem', { name: '第 1 筆' });
    const second = screen.getByRole('listitem', { name: '第 2 筆' });
    expect(within(first).getByText('請輸入大於 0 的整數金額')).toBeInTheDocument();
    expect(within(first).getByText('請選擇分類')).toBeInTheDocument();
    expect(within(second).getByText('請輸入項目')).toBeInTheDocument();
    expect(requestsTo('POST', '/api/transactions/batch')).toHaveLength(0);
  });

  it('全部空白時提示至少填一筆', async () => {
    const { user } = await renderBatch();
    await user.click(screen.getByRole('button', { name: /儲存/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('請至少填寫一筆');
  });

  it('新增與移除筆數；切換收支清空已選分類', async () => {
    const { user } = await renderBatch();
    await user.click(screen.getByRole('button', { name: '＋ 再加一筆' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: '移除第 4 筆' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);

    await user.selectOptions(screen.getByLabelText('分類 1'), '餐飲');
    await user.click(screen.getByRole('radio', { name: '收入' }));
    expect(screen.getByLabelText('分類 1')).toHaveValue('');
    await screen.findAllByRole('option', { name: '薪資' });
  });

  it('伺服器拒絕時顯示錯誤並保留輸入', async () => {
    server.use(
      http.post('*/api/transactions/batch', () =>
        errorResponse(400, 'CATEGORY_MISMATCH', '第 1 筆：分類不屬於所選帳本與收支'),
      ),
    );
    const { user } = await renderBatch();
    await user.type(screen.getByLabelText('項目 1'), '午餐');
    await user.type(screen.getByLabelText('金額 1'), '120');
    await user.selectOptions(screen.getByLabelText('分類 1'), '餐飲');
    await user.click(screen.getByRole('button', { name: '儲存 1 筆' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('所選分類與帳本或收支不符');
    expect(screen.getByLabelText('項目 1')).toHaveValue('午餐');
  });
});
