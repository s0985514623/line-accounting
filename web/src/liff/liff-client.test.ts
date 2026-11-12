/**
 * liff-client：唯一直接依賴 @line/liff SDK 的模組。
 *
 * 執行：npm --prefix web test -- src/liff/liff-client.test.ts
 * 假設的模組介面（web/src/liff/liff-client.ts）：
 *   initLiff(): Promise<'ready' | 'redirecting'>   先 fetch /liff/config.json → liff.init → 未登入則 liff.login()
 *   getIdToken(): string | null                    = liff.getIDToken()
 *   login(): void                                  = liff.login()
 * 模組為無狀態（不快取 init 結果）；bootstrap 只會呼叫 initLiff 一次。
 */
import { describe, expect, it } from 'vitest';
import { HttpResponse, http, LIFF_ID } from '../test/mocks/handlers';
import { liffMock } from '../test/mocks/liff';
import { server } from '../test/mocks/server';

async function loadClient() {
  return await import('./liff-client');
}

describe('liff-client / initLiff', () => {
  describe('Smoke', () => {
    it('先取得 /liff/config.json 的 liffId，再以該 liffId 呼叫 liff.init', async () => {
      const { initLiff } = await loadClient();

      await initLiff();

      expect(liffMock.init).toHaveBeenCalledTimes(1);
      expect(liffMock.init).toHaveBeenCalledWith(expect.objectContaining({ liffId: LIFF_ID }));
    });

    it('已登入時回傳 ready，且不呼叫 liff.login', async () => {
      liffMock.isLoggedIn.mockReturnValue(true);
      const { initLiff } = await loadClient();

      await expect(initLiff()).resolves.toBe('ready');

      expect(liffMock.login).not.toHaveBeenCalled();
    });
  });

  describe('Happy', () => {
    it('未登入時呼叫 liff.login 一次，並回傳 redirecting（呼叫端不應 render router）', async () => {
      liffMock.isLoggedIn.mockReturnValue(false);
      const { initLiff } = await loadClient();

      await expect(initLiff()).resolves.toBe('redirecting');

      expect(liffMock.login).toHaveBeenCalledTimes(1);
    });

    it('liff.init 完成之後才檢查登入狀態（順序：init → isLoggedIn）', async () => {
      const order: string[] = [];
      liffMock.init.mockImplementation(async () => {
        order.push('init');
      });
      liffMock.isLoggedIn.mockImplementation(() => {
        order.push('isLoggedIn');
        return true;
      });
      const { initLiff } = await loadClient();

      await initLiff();

      expect(order).toEqual(['init', 'isLoggedIn']);
    });

    it('getIdToken 回傳 liff.getIDToken() 的值；無 token 時回傳 null', async () => {
      const { getIdToken } = await loadClient();

      liffMock.getIDToken.mockReturnValue('abc.def.ghi');
      expect(getIdToken()).toBe('abc.def.ghi');

      liffMock.getIDToken.mockReturnValue(null);
      expect(getIdToken()).toBeNull();
    });

    it('login() 轉呼叫 liff.login 一次', async () => {
      const { login } = await loadClient();

      login();

      expect(liffMock.login).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error', () => {
    it('/liff/config.json 回 500 時 initLiff 失敗，且不呼叫 liff.init', async () => {
      server.use(http.get('*/liff/config.json', () => new HttpResponse(null, { status: 500 })));
      const { initLiff } = await loadClient();

      await expect(initLiff()).rejects.toBeInstanceOf(Error);

      expect(liffMock.init).not.toHaveBeenCalled();
    });

    it('/liff/config.json 缺少 liffId 時 initLiff 失敗，且不呼叫 liff.init', async () => {
      server.use(http.get('*/liff/config.json', () => HttpResponse.json({})));
      const { initLiff } = await loadClient();

      await expect(initLiff()).rejects.toBeInstanceOf(Error);

      expect(liffMock.init).not.toHaveBeenCalled();
    });

    it('/liff/config.json 網路錯誤時 initLiff 失敗', async () => {
      server.use(http.get('*/liff/config.json', () => HttpResponse.error()));
      const { initLiff } = await loadClient();

      await expect(initLiff()).rejects.toBeInstanceOf(Error);

      expect(liffMock.init).not.toHaveBeenCalled();
    });

    it('liff.init 拒絕時 initLiff 失敗，且不呼叫 liff.login', async () => {
      liffMock.init.mockRejectedValue(new Error('invalid liffId'));
      const { initLiff } = await loadClient();

      await expect(initLiff()).rejects.toBeInstanceOf(Error);

      expect(liffMock.login).not.toHaveBeenCalled();
    });
  });
});
