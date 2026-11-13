import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ApiError } from './api/http';
import { LoadingStatus } from './components/LoadingStatus';
import { BatchFormPage } from './pages/BatchFormPage';
import { CategoryPage } from './pages/CategoryPage';
import { TransactionFormPage } from './pages/TransactionFormPage';
import { TransactionListPage } from './pages/TransactionListPage';
import './styles/global.css';

/** 圖表頁含 Recharts（體積大），延遲載入以縮短 LIFF 首頁開啟時間。 */
const ChartPage = lazy(() =>
  import('./pages/ChartPage').then((module) => ({ default: module.ChartPage })),
);

/** 只對暫時性錯誤（網路、5xx）自動重試一次；4xx 與 401（HTTP 層已處理）不重試。 */
function shouldRetryQuery(failureCount: number, error: Error): boolean {
  if (failureCount >= 1) return false;
  return error instanceof ApiError && (error.status === 0 || error.status >= 500);
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

/**
 * 應用程式根元件：QueryClientProvider + BrowserRouter（basename /liff）。
 * 只在 LIFF 初始化完成（ready）後才由 bootstrap render，確保 router 讀到 liff.state 還原後的路徑。
 */
export function App() {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/liff">
        <Routes>
          <Route path="/" element={<TransactionListPage />} />
          <Route path="/new" element={<TransactionFormPage />} />
          <Route path="/edit/:id" element={<TransactionFormPage />} />
          <Route path="/batch" element={<BatchFormPage />} />
          <Route path="/categories" element={<CategoryPage />} />
          <Route
            path="/chart"
            element={
              <Suspense fallback={<LoadingStatus />}>
                <ChartPage />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
