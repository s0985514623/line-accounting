# 測試策略：LINE 記帳（供 tdd-coordinator 使用）

> 搭配 `implementation-plan.md`。語言：TypeScript。流程依 `zenbu-powers:aibdd-auto-tdd`（stage：control-flow → step-template/schema-analysis → red → green → refactor），handler 分類依 `zenbu-powers:aibdd-handlers`。
> 與 starter 差異：ORM 用 **Prisma**（非 Drizzle）；認證為 **LIFF ID token stub**（非 JWT helper）；規格**不搬移**，cucumber 直接讀 `specs/features/**/*.feature`。

---

## 1. 測試金字塔

| 層 | 工具 | 位置 | 涵蓋 | 執行 |
|----|------|------|------|------|
| 單元 | Vitest | `tests/unit/**` | domain 純函式、訊息 builder、codec、env、logger redact | `npm run test:unit` |
| HTTP | Vitest + supertest | `tests/http/**` | 規格未涵蓋的協定行為：webhook 簽章、healthz、liff-auth 邊界、liff-static | `npm run test:unit` |
| BDD 驗收 | Cucumber.js 10 + tsx + supertest + PostgreSQL | `specs/features/**` + `tests/bdd/**` | 14 個 feature（行為規格的唯一真相來源） | `npm run test:bdd` |
| 前端 | Vitest + RTL + MSW v2 | `web/src/**/*.test.tsx` | 四個 LIFF 頁面 | `npm run test:web` |
| 部署 smoke | GitHub Actions | `.github/workflows/ci.yml` job `image-smoke` | 映像可啟動、migrate、seed、healthz | CI |
| 手動 E2E | 真機 | `deployment-runbook.md` §9 | 三條 activity | 上線時 |

TDD 節奏：每個 feature 一個 Red→Green→Refactor 循環；domain 純函式（parser、codec、date-utils、monthly-report）**先寫單元測試**再寫實作，BDD 紅燈中卡住的計算細節用單元測試釘住。

---

## 2. Feature 執行順序（control-flow 批次）

| 批次 | Feature | 新增 step 類型 | 前置 |
|------|---------|---------------|------|
| B1 (P1) | access/加入好友 | W:加入好友、T:分類應為空 | P0 共用句型 |
| B2 (P3) | transaction/以文字訊息記帳 | T7 分類按鈕、T8 按鈕 | B1 |
| B3 (P3) | transaction/選擇分類完成記帳 | W2 postback、G6 token、T1n、T9 | B2 |
| B4 (P4) | transaction/請求刪除記帳紀錄、確認刪除記帳紀錄 | — | B3 |
| B5 (P5) | report/查詢月度文字摘要 | T12、T13、T14 | B2 |
| B6 (P6) | category/查詢分類列表、新增分類、刪除分類 | G7、W7–W9、T10、T11 | P0 |
| B7 (P7) | transaction/查詢記帳紀錄列表、以表單記帳、編輯、刪除；report/查詢月度統計圖表 | W3–W6、W10、T15 | B6 |

可用 tag 篩選單批：`npx cucumber-js specs/features/access`（以路徑篩選，不需修改規格加 tag）。

---

## 3. BDD 基礎建設（`tests/bdd/support/`）

### 3.1 World（`world.ts`）

```ts
class TestWorld extends World {
  app: Express;                    // createApp(deps)
  prisma: PrismaClient;
  clock: FixedClock;               // 預設 2026-11-12T04:00:00Z（台北 12:00）
  line: RecordingLineGateway;      // replies: { replyToken, messages: LineMessage[] }[]
  idToken: StubIdTokenVerifier;    // identity 字串 → sub；'(無效token)' → InvalidToken
  config: { ownerUserId: string; channelSecret: 'test-secret'; liffId: 'test-liff' };
  liffIdentity: string | null;     // G7 設定，W3–W10 使用
  lastResponse: supertest.Response | null;
  lastTransactionId: number | null; // 供 `$記帳紀錄.id` 解析
}
```

### 3.2 Hooks（`hooks.ts`、`db.ts`）

| Hook | 行為 |
|------|------|
| BeforeAll | 若有 `TEST_DATABASE_URL` 則直接用（CI service container / 本機 docker-compose.dev）；否則啟 `@testcontainers/postgresql`（`postgres:16`）。以子程序執行 `prisma migrate deploy`（帶 `DATABASE_URL`）。建立單一 PrismaClient。 |
| Before | `TRUNCATE categories, category_keywords, transactions, postback_tokens RESTART IDENTITY CASCADE`；重置 clock、line、idToken、liffIdentity、lastResponse。 |
| AfterAll | `prisma.$disconnect()`、停容器。 |

`db.ts` 提供 `insertWithIds(table, rows)`：寫入後 `SELECT setval(pg_get_serial_sequence('<table>','id'), GREATEST((SELECT MAX(id) FROM <table>),1))`。

### 3.3 Table mappers（`table-mappers.ts`）

| 中文值 | 內部值 |
|-------|-------|
| 帳本 個人/公司 | `personal` / `company` |
| 收支 支出/收入 | `expense` / `income` |
| 來源 LINE文字/LIFF表單 | `line_text` / `liff_form` |
| 其他分類 是/否 | `true` / `false` |
| 空白儲存格 | 欄位**省略**（LIFF 請求）／`null`（備註）／比對時視為 `''` |
| `"  "`（含引號） | 去掉引號後的字串（兩個空白） |
| 金額 | 符合數字 → `Number(x)`（`12.5` 送 12.5、`0` 送 0）；空 → 省略 |
| 分類（名稱） | 以 (帳本, 收支, 名稱) 查 id；Given 記帳紀錄的「分類」依該列帳本、收支解析 |

### 3.4 LINE 事件工廠（`line-event-factory.ts`）

- `followEvent(userId)`、`textEvent(userId, text)`、`postbackEvent(userId, data)`；replyToken 隨機。
- `postWebhook(world, events)`：`JSON.stringify` → HMAC-SHA256(base64, `test-secret`) → `x-line-signature` → supertest POST `/webhook/line`，斷言 HTTP 200。

### 3.5 Stubs（`stubs.ts`）

- `FixedClock.set('2026-11-12')` → 台北當日中午（避免時區邊界誤判）。
- `RecordingLineGateway`：記錄 domain 層 `LineMessage[]`（非 SDK JSON），另提供 `toSdk()` 結果供 builder 單元測試比對。
- `StubIdTokenVerifier`：`verify(token)`；token 即 identity 字串（`Bearer U-owner`）；`(無效token)` 拋 `InvalidToken`。

---

## 4. 句型 → Step handler 對照

| # | 句型 | Handler（aibdd-handlers） | 檔案 | 實作重點 |
|---|------|--------------------------|------|---------|
| G1 | `白名單 LINE userId 為 {string}` | aggregate-given（設定） | `steps/common/given.steps.ts` | 設定 `config.ownerUserId` 後重建 app |
| G2 | `今天為 {string}` | aggregate-given（時鐘） | 同上 | `clock.set(date)` |
| G3 | `系統中有以下分類：` | aggregate-given | 同上 | 有 id 欄位 → 指定 id；`其他分類` → isFallback |
| G4 | `系統中有以下記帳紀錄：` | aggregate-given | 同上 | 分類名 → id；日期 → date-only |
| G5 | `系統中有以下分類關鍵字：` | aggregate-given | 同上 | 冗餘 ledger/entry_type 一併寫入 |
| G6 | `系統中有以下已使用的分類按鈕 token：` | aggregate-given | 同上 | transaction_id = null |
| G7 | `LIFF 請求身分為 {string}` | aggregate-given（auth stub） | 同上 | 設 `liffIdentity` |
| W-follow | `{string} 加入好友` | command | `steps/access/access.steps.ts` | followEvent |
| W1 | `{string} 傳送文字訊息 {string}` | command | `steps/common/line.steps.ts` | textEvent |
| W2 | `{string} 點擊 postback {string}` | command | 同上 | postbackEvent（data 原字串直送，不重新編碼） |
| W3 | `記帳者以 LIFF 新增記帳紀錄：` | command | `steps/transaction/liff.steps.ts` | POST /api/transactions；欄位 `分類id → categoryId`、`日期 → occurredOn` |
| W4 | `記帳者以 LIFF 編輯記帳紀錄 {int}：` | command | 同上 | PUT |
| W5 | `記帳者以 LIFF 刪除記帳紀錄 {int}` | command | 同上 | DELETE |
| W6 | `記帳者以 LIFF 查詢記帳紀錄列表：` | query | 同上 | GET；空儲存格不帶 query param |
| W7 | `記帳者以 LIFF 查詢分類列表：` | query | `steps/category/category.steps.ts` | GET ?ledger&entryType |
| W8 | `記帳者以 LIFF 新增分類：` | command | 同上 | POST |
| W9 | `記帳者以 LIFF 刪除分類 {int}` | command | 同上 | DELETE |
| W10 | `記帳者以 LIFF 查詢月度統計：` | query | `steps/report/report.steps.ts` | GET；空儲存格不帶 |
| T1 | `回覆訊息應為 {string}` | readmodel-then | `steps/common/line.steps.ts` | 恰一次 reply；**第一則訊息**的文字（text 或 template 本文）完全相等 |
| T1n | `不回覆任何訊息` | readmodel-then | 同上 | replies 為空 |
| T7 | `回覆的分類按鈕應為：` | readmodel-then | `steps/transaction/line.steps.ts` | Quick Reply items：label 與 postback data 解析出的 categoryId；並驗 data 中 item/amount/date/ledger/type 與原訊息一致 |
| T8 | `回覆的按鈕應為：` | readmodel-then | 同上 | template actions（label、data）；`$記帳紀錄.id` → 資料庫中唯一一筆 transaction 的 id |
| T12 | `月度摘要回覆應為：` | readmodel-then | `steps/report/report.steps.ts` | 解析摘要文字（ASM-02 格式）的帳本、月份、三個合計 |
| T13 | `支出分類佔比應為：` / `支出分類佔比應為空` | readmodel-then | 同上 | LINE：解析「・」行；LIFF：`expenseByCategory`（ratio 格式化為 `x.y%`）。依 `lastResponse` 是否存在判斷來源 |
| T14 | `回覆應附圖表連結，參數為：` | readmodel-then | 同上 | 第二則 buttons template 的 URI；解析 query：`month`、`ledger`（中文 → enum） |
| T15 | `月度統計結果應為：` | readmodel-then | 同上 | response JSON |
| T2 | `操作成功` | success-failure | `steps/common/result.steps.ts` | 2xx |
| T3 | `操作失敗，violation_type 為 {string}` | success-failure | 同上 | body.violationType；並檢查 status 對照（400/401/403/404/409/422） |
| T4 | `記帳紀錄應為：` / `記帳紀錄應為空` | aggregate-then | `steps/common/state.steps.ts` | 依 id 排序；有 id 欄才比 id；空備註 = null |
| T5 | `分類應為：` / `分類應為空` | aggregate-then | 同上 | 完全比對（依 id 排序，忽略 id 欄） |
| T11 | `分類應包含：` | aggregate-then | `steps/category/category.steps.ts` | 子集比對 |
| T9 | `分類關鍵字應為：` / `分類關鍵字應為空` | aggregate-then | `steps/common/state.steps.ts` | 分類以名稱呈現 |
| T10 | `查詢結果應為：` / `查詢結果應為空` | readmodel-then | `steps/common/result.steps.ts` | `items` 順序必須相同（驗證排序規則） |

> Step 文字必須與 `.feature` **逐字一致**（含全形冒號「：」）。step-template stage 先用 `npx cucumber-js --dry-run` 取得 undefined snippet 再填入。

---

## 5. 單元與前端測試清單

### 後端單元（`tests/unit/`）

| 檔案 | 必測案例 |
|------|---------|
| `domain/text-entry-parser.test.ts` | 規格 5 種格式錯、3 種金額錯、5 種成功；全形「＋１２０」、全形空白、連續空白、`公文具 300`（項目=公文具、個人）、`+`、`公 +`、備註多詞、項目 51 字、金額 100000000、摘要指令 4 種與 `本月 ` 前後空白 |
| `domain/postback-codec.test.ts` | encode/decode 往返；備註含 `& = + %`；中文不編碼；剛好 300 / 301；缺欄位/金額非數字/日期不合法 → 失敗 |
| `domain/date-utils.test.ts` | UTC 15:59:59 → 台北同日、16:00:00 → 隔日；2026-01 上月 = 2025-12；`2026-02-30` 不合法；monthRange 半開區間 |
| `domain/monthly-report.test.ts` | 75.0/25.0、66.7/33.3、單一分類 100.0%、0 支出 → []、負結餘、同額排序 |
| `domain/default-categories.test.ts` | 19 筆、每組恰一個 fallback |
| `line/entry-replies.test.ts` | 摘要文字格式；Quick Reply 14 個分類 → 13 個且含其他；label 21 字截斷；altText ≤ 400 |
| `line/summary-replies.test.ts` | 無支出時無分類區塊；URI 正確 |
| `services/transaction-service.pick.test.ts` | Prisma P2002 → 此筆已記帳；分類錯誤時 token 不寫入（交易 rollback） |
| `config/env.test.ts` | 缺 key → 錯誤訊息列出 key、不含值 |
| `logging/redact.test.ts` | Authorization、x-line-signature、token 被遮蔽 |

### HTTP（`tests/http/`）

| 檔案 | 案例 |
|------|------|
| `webhook-signature.test.ts` | 無簽章 401；錯簽章 401 且 gateway 未呼叫、DB 未寫；`events: []` 200；非 JSON 400 |
| `health.test.ts` | DB 正常 200；DB 斷線 503 |
| `liff-auth.test.ts` | 無 Authorization 401；verifier 逾時 503；同 token 第二次不再呼叫 verifier |
| `liff-static.test.ts` | `/liff/config.json` 回 liffId；`/liff/edit/3` fallback index.html；assets 快取 header |

### 前端（`web/src/`）

| 頁面 | 案例 |
|------|------|
| TransactionListPage | 載入中 / 列表排序顯示 / 空狀態 / 切換月份與帳本重新查詢 / 刪除確認後列表更新 / 401 觸發 login |
| TransactionFormPage | 必填驗證 / 切換帳本清空分類 / 送出中按鈕 disable（雙擊只送一次）/ CATEGORY_MISMATCH 顯示中文 / 編輯模式預填 / 網路錯誤保留輸入 |
| CategoryPage | 「其他」無刪除鈕 / 新增空白名稱阻擋 / 409 顯示名稱重複 / 刪除提示改歸其他 |
| ChartPage | 讀 `?month&ledger` / 無參數預設本月個人 / 無支出空狀態 / 400 顯示錯誤 |
| liff-client | init 失敗顯示錯誤頁；未登入呼叫 login |

---

## 6. 測試資料與隔離原則

- 每個 Scenario 從空 DB 開始（TRUNCATE），只靠 Background + Given 建狀態；禁止 scenario 間共享狀態。
- 不打真實 LINE API：gateway / verifier 一律 stub；`line-messaging-gateway.ts` 與 `line-id-token-verifier.ts` 以 `msw/node` 或注入 `fetch` 做 adapter 單元測試（驗證請求格式、timeout、錯誤映射）。
- CI 中 BDD 使用 GitHub Actions `services: postgres`，以 `TEST_DATABASE_URL` 指定；本機可用 Testcontainers 或 `docker compose -f docker-compose.dev.yml up -d`。

## 7. 覆蓋率與關卡

- `src/domain/**` 行覆蓋 ≥ 90%；整體後端 ≥ 80%（vitest + cucumber 合併以 `c8` 統計，可選）。
- PR 關卡：typecheck、lint、test:unit、test:bdd、test:web、image-smoke 全綠才可合併。
- BDD 無 `undefined` / `pending` / `ambiguous` step（`cucumber-js --strict`）。
