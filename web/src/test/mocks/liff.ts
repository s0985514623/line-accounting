import { vi } from 'vitest';

/** 測試用的有效 ID token；MSW handlers 只接受此值（或測試自行指定的值）。 */
export const VALID_ID_TOKEN = 'test-id-token';

function createLiffMock() {
  return {
    init: vi.fn(),
    isLoggedIn: vi.fn(),
    login: vi.fn(),
    getIDToken: vi.fn(),
    closeWindow: vi.fn(),
    isInClient: vi.fn(),
  };
}

// 以 globalThis 單例保存：測試內即使 vi.resetModules()，vi.mock('@line/liff') 與測試取得的仍是同一個物件
const holder = globalThis as unknown as { __liffMock?: ReturnType<typeof createLiffMock> };
export const liffMock = (holder.__liffMock ??= createLiffMock());

/** 每個測試前重置為「已登入、init 成功、非 LINE App 內」的預設狀態。 */
export function resetLiffMock(): void {
  for (const fn of Object.values(liffMock)) fn.mockReset();
  liffMock.init.mockResolvedValue(undefined);
  liffMock.isLoggedIn.mockReturnValue(true);
  liffMock.getIDToken.mockReturnValue(VALID_ID_TOKEN);
  liffMock.isInClient.mockReturnValue(false);
}
