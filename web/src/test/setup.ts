import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { resetLiffMock } from './mocks/liff';
import { resetMockDb } from './mocks/handlers';
import { server } from './mocks/server';

// 所有 @line/liff 的 import 一律換成 mock（liff-client.ts 才是唯一直接依賴 SDK 的模組）
vi.mock('@line/liff', async () => ({
  default: (await import('./mocks/liff')).liffMock,
}));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  resetLiffMock();
  resetMockDb();
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.useRealTimers();
});

afterAll(() => server.close());
