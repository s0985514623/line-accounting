/**
 * 以 zod schema 驗證外部輸入；失敗時拋 DomainError('INVALID_ARGUMENT')，訊息指出欄位名稱（不回顯輸入值）。
 */
import type { z } from 'zod';
import { DomainError } from '../../domain/errors';

export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const fields = [
    ...new Set(result.error.issues.map((issue) => issue.path.map(String).join('.') || '(body)')),
  ];
  throw new DomainError('INVALID_ARGUMENT', `參數不合法：${fields.join(', ')}`);
}
