/** LIFF ID token 驗證（測試替身注入點）。 */

export interface VerifiedIdToken {
  /** LINE userId（與 Messaging API 同一 Provider 時與 webhook userId 相同） */
  sub: string;
}

export interface IdTokenVerifier {
  /** 驗證 ID token；無效（過期、簽章錯、client_id 不符）時拋出 InvalidTokenError。 */
  verify(idToken: string): Promise<VerifiedIdToken>;
}

/** ID token 無效（→ HTTP 401 UNAUTHENTICATED）。 */
export class InvalidTokenError extends Error {
  override readonly name = 'InvalidTokenError';

  constructor(message = 'ID token 無效') {
    super(message);
  }
}
