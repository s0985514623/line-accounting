import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

export interface TestRoute {
  path: string;
  element: ReactElement;
}

export type InitialEntry = string | { pathname: string; search?: string; state?: unknown };

function LocationProbe() {
  const location = useLocation();
  return (
    <div hidden>
      <span data-testid="location-pathname">{location.pathname}</span>
      <span data-testid="location-search">{location.search}</span>
    </div>
  );
}

/**
 * 在 QueryClientProvider + MemoryRouter 內 render 指定路由。
 * LocationProbe 提供 data-testid="location-pathname" / "location-search" 供斷言導覽結果。
 * QueryClient 的 retry 關閉（HTTP 層自身的 401 重試不受影響）。
 */
export function renderRoutes(routes: TestRoute[], entry: InitialEntry) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          {routes.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, user, queryClient };
}
