/**
 * OccurrenceConfirmPage（/recurring/occurrences/:id）與 RecurringPage 的主要流程。
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { errorResponse, http, HttpResponse } from '../test/mocks/handlers';
import { server } from '../test/mocks/server';
import { renderRoutes } from '../test/render';
import { OccurrenceConfirmPage } from './OccurrenceConfirmPage';
import { RecurringPage } from './RecurringPage';

const OCCURRENCE = {
  id: 7,
  recurringEntryId: 1,
  ledger: 'personal',
  entryType: 'expense',
  item: '房租',
  amount: 15000,
  categoryId: 3,
  categoryName: '居住',
  note: null,
  dueOn: '2026-12-05',
};

const ENTRY = {
  id: 1,
  ledger: 'personal',
  entryType: 'expense',
  item: '房租',
  amount: 15000,
  categoryId: 3,
  categoryName: '居住',
  dayOfMonth: 5,
  note: null,
  active: true,
  nextDueOn: '2027-01-05',
};

const TRANSACTION = {
  id: 99,
  ledger: 'personal',
  entryType: 'expense',
  item: '房租',
  amount: 15500,
  categoryId: 3,
  categoryName: '居住',
  occurredOn: '2026-12-05',
  note: null,
  source: 'liff_form',
};

function useOccurrences(items: unknown[]) {
  server.use(http.get('/api/recurring/occurrences', () => HttpResponse.json({ items })));
}

function renderConfirm() {
  return renderRoutes(
    [
      { path: '/recurring/occurrences/:id', element: <OccurrenceConfirmPage /> },
      { path: '/', element: <p>list</p> },
      { path: '/recurring', element: <p>recurring</p> },
    ],
    '/recurring/occurrences/7',
  );
}

describe('OccurrenceConfirmPage', () => {
  it('修改金額後確認入帳 → POST confirm 帶新金額，回到記帳列表', async () => {
    useOccurrences([OCCURRENCE]);
    let body: unknown;
    server.use(
      http.post('/api/recurring/occurrences/7/confirm', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(TRANSACTION, { status: 201 });
      }),
    );
    const { user } = renderConfirm();

    const amount = await screen.findByRole('spinbutton', { name: /本期金額/ });
    expect(amount).toHaveValue(15000);
    await user.clear(amount);
    await user.type(amount, '15500');
    await user.click(screen.getByRole('button', { name: '確認入帳' }));

    await waitFor(() => expect(screen.getByTestId('location-pathname')).toHaveTextContent('/'));
    expect(body).toEqual({ amount: 15500 });
  });

  it('略過 → POST skip，回到固定收支頁', async () => {
    useOccurrences([OCCURRENCE]);
    let skipped = false;
    server.use(
      http.post('/api/recurring/occurrences/7/skip', () => {
        skipped = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderConfirm();

    await user.click(await screen.findByRole('button', { name: '這期略過' }));
    await waitFor(() =>
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/recurring'),
    );
    expect(skipped).toBe(true);
  });

  it('金額不合法 → 不送出', async () => {
    useOccurrences([OCCURRENCE]);
    const { user } = renderConfirm();
    const amount = await screen.findByRole('spinbutton', { name: /本期金額/ });
    await user.clear(amount);
    await user.click(screen.getByRole('button', { name: '確認入帳' }));
    expect(await screen.findByText('請輸入大於 0 的整數金額')).toBeInTheDocument();
  });

  it('已處理過（409）→ 顯示錯誤', async () => {
    useOccurrences([OCCURRENCE]);
    server.use(
      http.post('/api/recurring/occurrences/7/confirm', () =>
        errorResponse(409, 'OCCURRENCE_RESOLVED'),
      ),
    );
    const { user } = renderConfirm();
    await user.click(await screen.findByRole('button', { name: '確認入帳' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('此期已處理過');
  });

  it('這期不在待確認清單 → 提示已處理', async () => {
    useOccurrences([]);
    renderConfirm();
    expect(await screen.findByRole('alert')).toHaveTextContent('已處理過');
  });
});

describe('RecurringPage', () => {
  it('顯示待確認與規則列表', async () => {
    useOccurrences([OCCURRENCE]);
    server.use(http.get('/api/recurring', () => HttpResponse.json({ items: [ENTRY] })));
    renderRoutes([{ path: '/recurring', element: <RecurringPage /> }], '/recurring');

    expect(await screen.findByRole('heading', { name: '待確認（1）' })).toBeInTheDocument();
    expect(await screen.findByText(/每月 5 號/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停用房租' })).toBeInTheDocument();
  });
});
