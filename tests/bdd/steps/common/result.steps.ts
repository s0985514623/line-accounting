/**
 * 共用結果 Then：T2、T3（success-failure）、T10（readmodel-then）。
 * 文字必須與 specs/features/**.feature 逐字一致（含全形「，」「：」）。
 *
 * 執行：npx cucumber-js [specs/features/<domain>]    乾跑：npm run test:bdd:dry
 */
import assert from 'node:assert/strict';
import { DataTable, Then } from '@cucumber/cucumber';
import { assertSameRows, requireResponse } from '../../support/assertions';
import { canonFromApi, canonFromExpected } from '../../support/table-mappers';
import type { TestWorld } from '../../support/world';

/** violation_type → HTTP 狀態（specs/api/api.yml） */
const STATUS_BY_VIOLATION: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  INVALID_ARGUMENT: 400,
  CATEGORY_MISMATCH: 400,
  NOT_FOUND: 404,
  DUPLICATE_NAME: 409,
  FALLBACK_CATEGORY_UNDELETABLE: 422,
};

// T2：2xx
Then('操作成功', function (this: TestWorld) {
  const response = requireResponse(this);
  assert.ok(
    response.status >= 200 && response.status < 300,
    `預期 2xx，實際 ${response.status}：${response.text}`,
  );
});

// T3：body.violationType 相符，且 HTTP 狀態與 api.yml 對照一致
Then('操作失敗，violation_type 為 {string}', function (this: TestWorld, violation: string) {
  const response = requireResponse(this);
  const expectedStatus = STATUS_BY_VIOLATION[violation];
  assert.ok(expectedStatus !== undefined, `未知的 violation_type：${violation}`);
  assert.equal(
    response.body?.violationType,
    violation,
    `violationType 不符（HTTP ${response.status}）：${response.text}`,
  );
  assert.equal(
    response.status,
    expectedStatus,
    `violation_type ${violation} 應對應 HTTP ${expectedStatus}`,
  );
  assert.equal(typeof response.body.message, 'string', 'Error 回應必須含 message 字串');
  assert.ok(response.body.message.length > 0, 'Error 回應的 message 不可為空');
});

// T10：items 順序必須相同（驗證排序規則）
Then('查詢結果應為：', function (this: TestWorld, table: DataTable) {
  const response = requireResponse(this);
  assert.equal(response.status, 200, `預期 HTTP 200，實際 ${response.status}：${response.text}`);
  const items: unknown = response.body?.items;
  assert.ok(Array.isArray(items), `回應必須含 items 陣列：${response.text}`);
  const headers = table.raw()[0] ?? [];
  const expected = table.hashes().map((row) => canonFromExpected(headers, row));
  const actual = (items as Array<Record<string, unknown>>).map((item) =>
    canonFromApi(headers, item),
  );
  assertSameRows('查詢結果', actual, expected);
});

Then('查詢結果應為空', function (this: TestWorld) {
  const response = requireResponse(this);
  assert.equal(response.status, 200, `預期 HTTP 200，實際 ${response.status}：${response.text}`);
  const items: unknown = response.body?.items;
  assert.ok(Array.isArray(items), `回應必須含 items 陣列：${response.text}`);
  assert.equal((items as unknown[]).length, 0, `查詢結果應為空，實際：${JSON.stringify(items)}`);
});
