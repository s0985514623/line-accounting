/**
 * AppShell：桌機（≥1024px）顯示側欄導覽；手機 / jsdom 預設不 render 側欄。
 * 執行：npm --prefix web test -- src/components/AppShell.test.tsx
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { liffMock } from '../test/mocks/liff';
import { AppShell } from './AppShell';

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function renderShell(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell>
        <p>頁面內容</p>
      </AppShell>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppShell', () => {
  it('手機寬度：只 render 頁面內容，不出現側欄', () => {
    stubMatchMedia(false);
    renderShell();
    expect(screen.getByText('頁面內容')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '側欄選單' })).not.toBeInTheDocument();
  });

  it('桌機寬度：顯示側欄並標示目前頁面', () => {
    stubMatchMedia(true);
    renderShell('/chart');
    const nav = screen.getByRole('navigation', { name: '側欄選單' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '統計圖表' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '記帳紀錄' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('頁面內容')).toBeInTheDocument();
  });

  it('桌機 + 外部瀏覽器：顯示登出按鈕', () => {
    stubMatchMedia(true);
    liffMock.isInClient.mockReturnValue(false);
    renderShell();
    expect(screen.getByRole('button', { name: '登出' })).toBeInTheDocument();
  });

  it('桌機 + LINE App 內：不顯示登出按鈕', () => {
    stubMatchMedia(true);
    liffMock.isInClient.mockReturnValue(true);
    renderShell();
    expect(screen.queryByRole('button', { name: '登出' })).not.toBeInTheDocument();
  });
});
