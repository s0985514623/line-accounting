/**
 * 回歸測試：在列表切到其他月份後編輯紀錄，儲存（或按返回）要回到原本的月份 / 帳本，
 * 而不是被重設成本月。
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readReturnTo } from '../lib/edit-route-state';
import { addMockTransaction, requestsTo } from '../test/mocks/handlers';
import { renderRoutes } from '../test/render';
import { TransactionFormPage } from './TransactionFormPage';
import { TransactionListPage } from './TransactionListPage';

const MAY_ROW = {
  id: 70,
  ledger: 'personal' as const,
  entryType: 'expense' as const,
  item: '五月午餐',
  amount: 150,
  categoryId: 1,
  categoryName: '餐飲',
  occurredOn: '2026-05-01',
  note: null,
  source: 'liff_form' as const,
};

function renderApp(entry: string) {
  return renderRoutes(
    [
      { path: '/', element: <TransactionListPage /> },
      { path: '/edit/:id', element: <TransactionFormPage /> },
    ],
    entry,
  );
}

describe('編輯後回到原本的列表月份', () => {
  it('5 月列表 → 編輯 5/1 → 儲存 → 回到 5 月列表', async () => {
    addMockTransaction(MAY_ROW);
    const { user } = renderApp('/?month=2026-05&ledger=personal');

    await user.click(await screen.findByRole('link', { name: /五月午餐/ }));
    const amount = await screen.findByLabelText('金額');
    await user.clear(amount);
    await user.type(amount, '180');
    await user.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(screen.getByLabelText('月份')).toHaveValue('2026-05'));
    expect(screen.getByTestId('location-search')).toHaveTextContent('month=2026-05');
    const lastList = requestsTo('GET', '/api/transactions').at(-1);
    expect(lastList?.query).toEqual({ month: '2026-05', ledger: 'personal' });
  });

  it('在列表切換月份後，網址記住月份；按「返回列表」也回到該月', async () => {
    addMockTransaction(MAY_ROW);
    const { user } = renderApp('/');

    // 原生 month input 在 jsdom 無法逐字輸入，直接觸發 change
    fireEvent.change(await screen.findByLabelText('月份'), { target: { value: '2026-05' } });
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).toHaveTextContent('month=2026-05'),
    );

    await user.click(await screen.findByRole('link', { name: /五月午餐/ }));
    await user.click(await screen.findByRole('link', { name: '返回列表' }));
    await waitFor(() => expect(screen.getByLabelText('月份')).toHaveValue('2026-05'));
  });
});

describe('readReturnTo', () => {
  it('只接受站內路徑', () => {
    expect(readReturnTo({ returnTo: '/?month=2026-05' })).toBe('/?month=2026-05');
    expect(readReturnTo({ returnTo: '/chart?month=2026-05&ledger=company' })).toBe(
      '/chart?month=2026-05&ledger=company',
    );
    expect(readReturnTo({ returnTo: '//evil.example' })).toBe('/');
    expect(readReturnTo({ returnTo: 'https://evil.example' })).toBe('/');
    expect(readReturnTo(null)).toBe('/');
    expect(readReturnTo({})).toBe('/');
  });
});
