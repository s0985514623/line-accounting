/**
 * 領域錯誤（單一來源）。service 拋出 DomainError(violationType)；
 * LIFF API 由 http/middleware/error-handler 映射為 HTTP 狀態，LINE handler 映射為回覆文字。
 */

/** 與 specs/api/api.yml `Error.violationType` enum 一致。 */
export const VIOLATION_TYPES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'CATEGORY_MISMATCH',
  'DUPLICATE_NAME',
  'FALLBACK_CATEGORY_UNDELETABLE',
  'OCCURRENCE_RESOLVED',
] as const;

export type ViolationType = (typeof VIOLATION_TYPES)[number];

/** 業務規則違反。message 為可直接顯示給使用者的中文訊息。 */
export class DomainError extends Error {
  override readonly name = 'DomainError';

  constructor(
    readonly violationType: ViolationType,
    message: string,
  ) {
    super(message);
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
