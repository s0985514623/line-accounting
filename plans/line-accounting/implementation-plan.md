# 實作計劃：LINE 記帳（Phase 05–07：Backend TDD / LIFF 前端 / 整合部署）

> 建立日期：2026-11-12｜範圍模式：**HOLD SCOPE（規格鎖定的 greenfield）**｜預估複雜度：**高**
>
> 配套文件（同目錄）：
> - `test-strategy.md` — BDD/TDD 測試策略、句型 → step handler 對照、測試基礎建設（供 tdd-coordinator 使用）
> - `deployment-runbook.md` — Dockerfile / compose / Caddy / GitHub Actions / secrets / VPS 一次性設定清單
> - `execution-plan.md` — Phase 01–07 總覽（既有）

---

## 範圍模式判定

| 判定 | 結果 | 理由 |
|------|------|------|
| 預設（greenfield） | EXPANSION | — |
| **實際採用** | **HOLD SCOPE** | Phase 01–04 已完成且 CiC = 0；14 個 `.feature` + `api.yml` + `erm.dbml` 已鎖定行為。此階段不再擴張功能，只專注於「把規格做成防彈實作」與部署。 |
| 檔案數 | 約 85–100 個新檔（greenfield 本質） | 已拆成 10 個可獨立合併的階段（每階段 ≤ 15 檔），以批次 + 驗證關卡控管。不需 REDUCTION——功能範圍已是 MVP（收據照片、多使用者、多幣別已在澄清時排除）。 |

本計劃中所有超出規格的決策皆以 **`ASM-xx`** 標記（見「假設與待確認事項」），tdd-coordinator 可直接採用；標為「需使用者確認」者在對應階段開工前確認即可，不阻擋前面階段。

---

## 概述

建構一個單一使用者（白名單 LINE userId）的 LINE 記帳服務：LINE Bot 以文字快速記帳、分類按鈕學習、刪除確認、月度文字摘要；LIFF 前端提供表單記帳、列表/編輯/刪除、分類管理、月報圖表。後端 Node.js + TypeScript + Express + Prisma + PostgreSQL，以單一 app container 加入 VPS 既有共用 Docker Compose 環境（共用 Caddy、共用 PostgreSQL），由 GitHub Actions 建置映像並經 SSH 部署。

## 需求重述

- **服務對象**：唯一的記帳者（擁有者本人）；其他 LINE 使用者（訪客）一律回「此服務不開放使用」，不寫入任何資料（postback 不回覆；LIFF 回 403）。
- **建構內容**：
  1. `POST /webhook/line`：follow（seed 19 個預設分類 + 歡迎訊息）、文字記帳（`[公 ][+]項目 金額[ 備註]`）、分類 Quick Reply（無狀態草稿 + 一次性 token）、關鍵字自動學習、刪除→確認/取消、`本月/上月/公 本月/公 上月` 月度摘要（附 LIFF 圖表連結）。
  2. `/api/*`（LIFF ID token 驗證 + 白名單）：記帳 CRUD + 列表、分類查詢/新增/刪除（刪除時紀錄改歸「其他」）、月度統計。
  3. LIFF SPA：列表（月份 × 帳本）、新增/編輯表單、分類管理、圖表頁（收支長條 + 支出圓餅）。
  4. 部署：Dockerfile、compose 片段、Caddyfile 片段、`prisma migrate deploy` 部署流程、secrets 管理、GitHub Actions CI/CD、VPS 一次性設定。
  5. LINE 設定：Messaging API channel、LINE Login channel + LIFF app、Rich Menu。
- **成功的樣子**：14 個 feature 全綠（Cucumber）、單元/前端測試全綠；push main 後 10 分鐘內自動上線、健康檢查通過；擁有者在手機上走完 3 條 activity（LINE 快速記帳、LIFF 帳目維護、統計查詢）。

---

## 規格對照（Feature → 階段）

| # | Feature | 入口 | 階段 |
|---|---------|------|------|
| 1 | access/加入好友.feature | webhook follow | P1 |
| 2 | transaction/以文字訊息記帳.feature | webhook message | P3 |
| 3 | transaction/選擇分類完成記帳.feature | webhook postback `pick` | P3 |
| 4 | transaction/請求刪除記帳紀錄.feature | webhook postback `delete` | P4 |
| 5 | transaction/確認刪除記帳紀錄.feature | webhook postback `delete_confirm/cancel` | P4 |
| 6 | report/查詢月度文字摘要.feature | webhook message | P5 |
| 7 | category/查詢分類列表.feature | GET /api/categories | P6 |
| 8 | category/新增分類.feature | POST /api/categories | P6 |
| 9 | category/刪除分類.feature | DELETE /api/categories/{id} | P6 |
| 10 | transaction/查詢記帳紀錄列表.feature | GET /api/transactions | P7 |
| 11 | transaction/以表單記帳.feature | POST /api/transactions | P7 |
| 12 | transaction/編輯記帳紀錄.feature | PUT /api/transactions/{id} | P7 |
| 13 | transaction/刪除記帳紀錄.feature | DELETE /api/transactions/{id} | P7 |
| 14 | report/查詢月度統計圖表.feature | GET /api/reports/monthly | P7 |

execution-plan 對應：P0、P1、P3–P7 = **Phase 05 Backend TDD**；P8 = **Phase 06 Frontend Build**；P2、P9 = **Phase 07 Integration / Deploy**。

---

## 已知風險（來自研究）

| # | 風險 | 來源 | 需求中是否已處理 | 緩解措施 |
|---|------|------|-----------------|---------|
| R1 | **Node.js 20 已於 2026-04-30 EOL**，不再有安全更新 | Node.js release schedule | 否（技術棧定為 Node 20） | **需使用者確認**：建議改 Node 22 LTS（維護至 2027-04）或 Node 24 LTS。計劃將版本集中於 `.nvmrc`、`Dockerfile ARG NODE_VERSION`、CI `node-version-file`，切換只改一處。預設仍照定案寫 20。 |
| R2 | **LINE userId 依 Provider 而異**：Messaging API channel 與 LINE Login channel（LIFF 所屬）若在不同 Provider，webhook 的 userId 與 LIFF ID token 的 `sub` 不同，白名單會對不上 | LINE Developers 文件（User ID 範圍為 provider） | 否 | VPS 清單強制兩 channel 建在**同一 Provider**；部署後驗收步驟比對兩邊 userId。 |
| R3 | **LIFF 屬於 LINE Login channel**，ID token 驗證需 `client_id = LINE Login channel ID`，不是 Messaging API channel | LINE verify ID token API | 否（secrets 清單沒有） | 新增環境變數 `LINE_LOGIN_CHANNEL_ID`；LIFF app scope 必須含 `openid`。 |
| R4 | **Postback data 上限 300 字元**；URLSearchParams 會把中文百分比編碼（每字 9 字元），`item`(≤50) + `note` 很容易爆 | Messaging API reference（postback action data max 300） | 否 | 自訂 codec：只跳脫 `% & = +`，保留中文原字；組好後若 > 300 字元 → 回覆「備註太長，請縮短後重新傳送，或改用表單記帳」（ASM-05）。 |
| R5 | **Quick Reply 最多 13 個按鈕、label 最多 20 字** | Messaging API reference | 否（使用者可自增分類） | 超過 13 個時取前 12 個一般分類（依 id）+「其他」；label 超過 20 字截斷加「…」（ASM-06）。 |
| R6 | Buttons template 文字上限 160 字（無標題/圖片）、Confirm template 240 字 | Messaging API reference | 部分 | 記帳成功回覆最長約 130 字（項目 50 + 分類 50）在上限內；builder 仍做長度保護並有單元測試。 |
| R7 | **Webhook 簽章需原始 body**：若先經 `express.json()` 再驗簽會失敗 | @line/bot-sdk 文件 | 否 | `/webhook/line` 路由使用 `express.raw({ type: '*/*' })`，以 `validateSignature(rawBody, secret, signature)` 驗證；JSON 解析放在驗簽之後。 |
| R8 | Reply token 只能用一次且有時效；處理過慢或例外會導致使用者無回覆；回 5xx 且開啟 redelivery 時會重送造成重複記帳 | Messaging API webhook 文件 | 部分（pick 有 token 防重） | 同步處理 + 每事件 try/catch，業務錯誤一律 HTTP 200；LINE console **關閉 webhook redelivery**（ASM-10）；pick 以 DB PK 防重。 |
| R9 | **LIFF 深層連結**：`https://liff.line.me/{liffId}/chart?month=…` 首次載入時路徑/參數放在 `liff.state`，`liff.init()` 完成前 router 讀不到 | LIFF 文件（secondary redirect） | 否 | 前端在 `liff.init()` resolve 後才掛載 router；圖表頁讀 query 有單元測試。 |
| R10 | LIFF ID token 會過期（約 1 小時；`liff.getIDToken()` 可能回傳過期 token） | LIFF 文件 / 社群回報 | 否 | API 收到 401 → 前端呼叫 `liff.login()` 重新取得；後端以 `exp` 為上限做記憶體快取（避免每次打 verify API）。 |
| R11 | Prisma `@db.Date` 在 JS 端是 UTC 午夜的 `Date`，與 Asia/Taipei 換算容易差一天 | Prisma issue 常見問題 | 否 | 全專案日期以 `'YYYY-MM-DD'` 字串流通；只在 repository 邊界經 `src/db/date-only.ts` 轉 `new Date(Date.UTC(y,m-1,d))`；「今天」由 `Clock` 以 `Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'})` 計算。 |
| R12 | Prisma schema 不支援 partial unique index（「每個帳本×收支恰一個『其他』」） | Prisma 文件 | 否 | 於 init migration SQL 手動加入 `CREATE UNIQUE INDEX … WHERE is_fallback`；amount 加 `CHECK (amount > 0)`。 |
| R13 | 測試 Given 以指定 id 寫入後，序列未前進 → 後續 insert PK 衝突 | PostgreSQL serial 行為 | 否 | Before hook 使用 `TRUNCATE … RESTART IDENTITY CASCADE`；Given 寫入指定 id 後執行 `setval(pg_get_serial_sequence(...), max(id))`。 |
| R14 | PostgreSQL 15+ 已移除 PUBLIC 在 `public` schema 的 CREATE 權限；若 database 不是 app user 所有，`prisma migrate deploy` 會失敗 | PostgreSQL 15 release notes | 否 | VPS 清單：`CREATE DATABASE line_accounting OWNER line_accounting`；`REVOKE CONNECT … FROM PUBLIC`。 |
| R15 | Prisma 大版本變動（7.x 引入 `prisma.config.ts` / driver adapter 必要化） | Prisma release notes | 否 | Scaffold 時鎖定**精確版本**（`npm i -E`）；預設採 Prisma 6.x 穩定線；若改 7.x，P0 需加 `prisma.config.ts` 並更新本計劃 P0 步驟。 |
| R16 | Windows 開發機：CRLF 破壞 shell script / Dockerfile；Testcontainers 需 Docker Desktop（WSL2） | 常見 | 否 | `.gitattributes` 強制 LF；npm scripts 不用 POSIX 專屬指令；測試 DB 支援 `TEST_DATABASE_URL` 覆寫（可改用 `docker-compose.dev.yml` 的 Postgres；CI 用 service container）。 |
| R17 | 共用 Docker 網路上 service 名稱衝突（多套應用都叫 `app`） | Docker Compose DNS | 否 | service 命名 `line-accounting`，Caddy 以此名稱反代。 |
| R18 | 部署失敗時 migration 無法自動回滾（Prisma 無 down migration） | Prisma 文件 | 否 | Migration 一律「先擴充、後收斂」（向後相容）；migrate 失敗則不切換容器；資料性 migration 前手動備份（runbook 有步驟）。 |
| R19 | 加入 `docker` 群組的 deploy user 等同 root | Docker security 文件 | 否 | SSH key 以 `command="…/deploy.sh"` forced command 限制只能執行部署腳本；known_hosts 釘選。 |

---

## 架構變更（全部為新增）

```
D:\Dev\line-accounting\
├─ .gitattributes / .gitignore / .editorconfig / .nvmrc / .env.example
├─ package.json / package-lock.json / tsconfig.json / tsconfig.build.json
├─ cucumber.cjs / vitest.config.ts / eslint.config.js / .prettierrc.json
├─ docker-compose.dev.yml                 # 本機開發/測試用 Postgres（僅開發機）
├─ Dockerfile / .dockerignore
├─ prisma/
│  ├─ schema.prisma
│  └─ migrations/<ts>_init/migration.sql  # 含 partial unique index、CHECK
├─ src/
│  ├─ server.ts                           # 進入點：讀 env → 建 deps → listen → graceful shutdown
│  ├─ app.ts                              # createApp(deps): Express（可注入，供測試）
│  ├─ config/env.ts                       # zod 驗證環境變數，fail fast
│  ├─ domain/                             # 純函式，無 I/O
│  │  ├─ enums.ts                         # Ledger/EntryType/EntrySource + 中文標籤對照
│  │  ├─ errors.ts                        # DomainError(violationType, message)
│  │  ├─ text-entry-parser.ts             # 「[公 ][+]項目 金額[ 備註]」解析 + 摘要指令判斷
│  │  ├─ postback-codec.ts                # pick/delete/confirm data 編解碼 + 300 字元檢查
│  │  ├─ date-utils.ts                    # Taipei 今天、YYYY-MM 驗證、上月（跨年）、月份區間
│  │  ├─ default-categories.ts            # 19 個預設分類
│  │  └─ monthly-report.ts                # 合計/結餘/佔比（整數運算四捨五入、排序）
│  ├─ ports/                              # 介面（測試替身注入點）
│  │  ├─ clock.ts / line-reply-gateway.ts / id-token-verifier.ts
│  ├─ adapters/
│  │  ├─ system-clock.ts
│  │  ├─ line-messaging-gateway.ts        # @line/bot-sdk MessagingApiClient.replyMessage
│  │  └─ line-id-token-verifier.ts        # POST https://api.line.me/oauth2/v2.1/verify + exp 快取
│  ├─ db/
│  │  ├─ prisma.ts                        # PrismaClient 單例
│  │  └─ date-only.ts                     # 'YYYY-MM-DD' <-> Date(UTC)
│  ├─ repositories/
│  │  ├─ category-repository.ts / keyword-repository.ts
│  │  ├─ transaction-repository.ts / postback-token-repository.ts
│  ├─ services/
│  │  ├─ onboarding-service.ts            # ensureDefaultCategories（follow 與 CLI 共用）
│  │  ├─ category-service.ts              # list/create/delete（改歸其他、刪關鍵字，單一 DB 交易）
│  │  ├─ category-matcher.ts              # 名稱優先 → 關鍵字
│  │  ├─ transaction-service.ts           # create/update/delete/list、pick 完成記帳（token + 學習）
│  │  └─ report-service.ts                # 月度報表（LINE 摘要與 LIFF 共用）
│  ├─ line/
│  │  ├─ webhook-route.ts                 # raw body + 驗簽 + JSON parse + dispatch，回 200/401
│  │  ├─ event-dispatcher.ts              # 依事件類型與文字/action 分派；白名單檢查
│  │  ├─ handlers/follow-handler.ts
│  │  ├─ handlers/text-message-handler.ts
│  │  ├─ handlers/postback-handler.ts
│  │  └─ messages/                        # 回覆訊息 builder（純函式）
│  │     ├─ texts.ts                      # 共用文字常數（格式說明、不開放…）
│  │     ├─ entry-replies.ts              # 已記帳摘要 + 刪除按鈕、分類 Quick Reply、刪除確認
│  │     └─ summary-replies.ts            # 月度摘要文字 + 圖表連結 buttons template
│  ├─ http/
│  │  ├─ middleware/liff-auth.ts          # Bearer → verifier → 白名單 → req.userId
│  │  ├─ middleware/error-handler.ts      # DomainError → {message, violationType} + HTTP code
│  │  ├─ middleware/request-logger.ts     # pino-http（遮蔽 Authorization / 簽章）
│  │  ├─ schemas/                         # zod：transaction-input、category-input、query params
│  │  ├─ mappers.ts                       # Prisma row → API DTO
│  │  └─ routes/{transactions,categories,reports,health,liff-static}.ts
│  └─ cli/
│     ├─ seed-defaults.ts                 # 部署時執行，冪等
│     └─ setup-rich-menu.ts               # 建立/上傳/設定預設 Rich Menu
├─ tests/
│  ├─ unit/**/*.test.ts                   # Vitest：domain、builder、codec、env
│  ├─ http/**/*.test.ts                   # Vitest + supertest：簽章 401、healthz、liff-static
│  └─ bdd/
│     ├─ support/{world,hooks,db,table-mappers,line-event-factory,stubs}.ts
│     └─ steps/{common,access,transaction,category,report}/*.steps.ts
├─ web/                                   # LIFF SPA（獨立 package.json）
│  ├─ package.json / vite.config.ts / tsconfig.json / index.html / vitest.config.ts
│  └─ src/
│     ├─ main.tsx（liff.init 後才 render）/ App.tsx（react-router，basename /liff）
│     ├─ liff/liff-client.ts              # 封裝 init / getIDToken / login / isInClient
│     ├─ api/{http.ts,schemas.ts,transactions.ts,categories.ts,reports.ts}
│     ├─ pages/{TransactionListPage,TransactionFormPage,CategoryPage,ChartPage}.tsx
│     ├─ components/{MonthPicker,LedgerToggle,EntryTypeToggle,CategorySelect,ConfirmDialog,ErrorBanner}.tsx
│     └─ test/{setup.ts,mocks/handlers.ts,mocks/server.ts}
├─ deploy/
│  ├─ compose.yml                         # 本應用 compose（加入共用外部網路）
│  ├─ Caddyfile.snippet
│  ├─ deploy.sh                           # VPS 端部署腳本（forced command）
│  ├─ sql/create-database.sql
│  └─ rich-menu/rich-menu.png             # 2500×1686
└─ .github/workflows/{ci.yml,deploy.yml}
```

**關鍵架構決策**

| 決策 | 選擇 | 理由 |
|------|------|------|
| HTTP 框架 | Express 4.21（鎖精確版） | 與 aibdd-auto-tdd TypeScript 後端 starter 一致；@line/bot-sdk 範例皆為 Express。 |
| ORM | Prisma（取代 starter 的 Drizzle） | 技術棧定案。starter 僅作結構參考。 |
| 驗證 | zod | API 輸入、env、postback data 皆用同一套。 |
| 分層 | route/handler → service → repository；domain 純函式 | 可測性：domain 單元測試、service 經 BDD 覆蓋。 |
| 依賴注入 | `createApp({ prisma, clock, lineGateway, idTokenVerifier, config })` | BDD 注入固定時鐘、LINE stub、身分 stub。 |
| 前端 | Vite + React 18 + TS + react-router + TanStack Query + Recharts | 輕量 SPA；同 container 由 Express 以 `/liff/` 提供靜態檔。 |
| LIFF ID 注入 | 執行期 `GET /liff/config.json` 由 env 回傳 | 同一映像可用於不同環境，免 rebuild。 |
| 部署形態 | 單一映像（後端 + 前端 dist），GHCR 推送，VPS 拉取 | VPS 不需建置資源；可依 tag 回滾。 |
| Migration 執行 | 部署腳本以一次性容器 `prisma migrate deploy`，成功後才 `up -d` | 失敗點明確、不與啟動耦合、不會多副本競爭。 |

---

## 資料流分析

### DF-1 Webhook 文字記帳（以文字訊息記帳 / 月度摘要分派）

```
POST /webhook/line ──▶ 驗簽(raw body) ──▶ JSON parse ──▶ 逐事件 dispatch ──▶ 白名單 ──▶ 文字分派
      │                    │                  │                 │                 │            │
      ▼                    ▼                  ▼                 ▼                 ▼            ▼
 [body 空?]          [簽章錯→401,      [JSON 壞→400,     [events=[]→200     [非白名單→     [摘要指令→DF-4]
 [無簽章→401]         不處理事件]       記 log]           (LINE 驗證用)]     回不開放]      [其他→解析]
                                                         [非 user 來源→略過]
解析 ──▶ 分類比對 ──▶ 寫入 transaction ──▶ 回覆 builder ──▶ Reply API
  │          │               │                  │               │
  ▼          ▼               ▼                  ▼               ▼
[格式錯→   [名稱命中→記帳]  [DB 失敗→記 log,   [文字>160→      [token 過期/
 格式說明]  [關鍵字命中→記帳] 回「系統忙碌」]   截斷保護]       LINE 5xx→記 log,
[金額非正整數 [未命中→Quick Reply 不寫入]                       不重試、HTTP 仍 200]
 →金額錯誤]  [分類=0→自動 seed 後重比（ASM-08）]
[項目>50→ASM-04]
[data>300→ASM-05]
```

### DF-2 分類按鈕 postback（選擇分類完成記帳）

```
postback data ──▶ 白名單 ──▶ decode+zod ──▶ DB 交易開始 ──▶ 分類檢查 ──▶ INSERT token ──▶ INSERT tx ──▶ 學習關鍵字 ──▶ COMMIT ──▶ 回覆
     │              │            │               │               │              │              │              │              │
     ▼              ▼            ▼               ▼               ▼              ▼              ▼              ▼              ▼
 [data 空]     [非白名單→     [欄位缺/竄改→   [逾時→rollback  [不存在→「分類  [PK 衝突(P2002) [CHECK 失敗→   [是「其他」→   [失敗→回
               不回覆]        回「資料格式     回系統忙碌]     不存在，請重新   →rollback，    rollback]       不學習]        「系統忙碌」]
                              錯誤」ASM-07]                    記帳」]          回「此筆已記帳」]              [關鍵字已存在→
                                                              [不符→「分類不符…」]                             upsert 改指向]
```
> 檢查順序：先查 token 是否已使用（符合 feature：tk1 已用 + 合法分類 → 此筆已記帳），再查分類；分類錯誤**不消耗** token（整段同一 DB 交易）。

### DF-3 LIFF API 寫入（以表單記帳 / 編輯）

```
Request ──▶ liff-auth ──▶ zod 驗證 ──▶ 分類/紀錄存在 ──▶ 分類一致 ──▶ PERSIST ──▶ 201/200 JSON
   │            │             │               │                │            │            │
   ▼            ▼             ▼               ▼                ▼            ▼            ▼
[無 Header→  [verify 失敗→  [必填缺/金額    [紀錄不存在→     [帳本/收支    [P2025 併發   [前端:
 401]         401]          ≤0/小數/日期     404 NOT_FOUND]   不符→400      刪除→404]     重複點擊
             [LINE verify    不合法→400]   [分類不存在→      CATEGORY_     [DB 錯→500]   →按鈕 disable]
              逾時→503       [item 空白→400] 404 NOT_FOUND]   MISMATCH]
              ASM-12]
             [sub≠owner→403]
```

### DF-4 月度報表（LINE 摘要與 LIFF 共用 report-service）

```
指令/參數 ──▶ 解析月份(Taipei) ──▶ 月份區間 [start, nextStart) ──▶ groupBy(entry_type, category) ──▶ 計算 ──▶ 呈現
    │              │                        │                              │                     │          │
    ▼              ▼                        ▼                              ▼                     ▼          ▼
[未帶→本月個人] [2026-13/202611→400]   [一月「上月」→前年12]          [無資料→0,0,0,[]]   [佔比四捨五入   [LINE: 文字+
[帳本非法→400]                                                                              整數運算]      圖表按鈕]
                                                                                           [同額→id 升冪] [LIFF: JSON]
```

### DF-5 部署

```
push main ──▶ CI(測試) ──▶ build+push GHCR(:sha) ──▶ SSH deploy.sh <sha> ──▶ pull ──▶ migrate ──▶ seed ──▶ up -d ──▶ healthz
    │             │                │                         │                 │          │         │         │          │
    ▼             ▼                ▼                         ▼                 ▼          ▼         ▼         ▼          ▼
               [失敗→停]       [GHCR 失敗→停]           [host key 不符→停]  [拉取失敗  [失敗→停,  [失敗→停] [啟動失敗] [逾時→回滾
                                                         [並行部署→concurrency 排隊] →停]  舊容器續跑]                    上一個 tag]
```

---

## 錯誤處理登記表

| 方法/路徑 | 可能失敗原因 | 錯誤類型 | 處理方式 | 使用者可見? |
|-----------|-------------|---------|---------|-----------|
| `webhook-route` 驗簽 | 簽章缺/錯 | 401 | 回 `{message, violationType:'UNAUTHENTICATED'}`，不處理事件，log warn | 否（LINE 平台） |
| `webhook-route` JSON | body 非 JSON | 400 | log warn | 否 |
| `event-dispatcher` 單一事件 | 任一 handler 拋出未預期例外 | 500（內部） | catch → log error（含 eventId、無個資）→ 嘗試回覆「系統忙碌，請稍後再試」→ 繼續下一事件；HTTP 仍 200 | 是 |
| `text-message-handler` | 格式錯 | 業務 | 回格式說明 | 是 |
| `text-message-handler` | 金額 0/負/小數 | 業務 | 回「金額必須為正整數」 | 是 |
| `text-message-handler` | 金額 > 99,999,999 | 業務 | 回「金額超過上限」（ASM-03） | 是 |
| `text-message-handler` | 項目 > 50 字 | 業務 | 回「項目最多 50 字」（ASM-04） | 是 |
| `entry-replies.buildCategoryQuickReply` | postback data > 300 | 業務 | 回「備註太長…」（ASM-05） | 是 |
| `postback-handler` pick | token 已用（含併發 P2002） | 業務 | 回「此筆已記帳」 | 是 |
| `postback-handler` pick | 分類不存在/不符 | 業務 | 回規格文字 | 是 |
| `postback-handler` pick | data 竄改/欄位不合法 | 業務 | 回「資料格式錯誤，請重新記帳」（ASM-07） | 是 |
| `postback-handler` delete/confirm | 紀錄不存在（含 P2025 併發） | 業務 | 回「此紀錄已不存在」 | 是 |
| `postback-handler` | 未知 action | 忽略 | log info，不回覆 | 否（可接受：只可能來自舊版按鈕） |
| `line-messaging-gateway.reply` | token 過期 / 400 / 5xx / 網路 | 外部 | log error（含 HTTP status、x-line-request-id），不重試（token 一次性） | 否——**已登記**：資料已寫入，使用者可於列表確認；不視為 CRITICAL（有 log） |
| `liff-auth` | 無 Bearer / verify 400 | 401 | `UNAUTHENTICATED` | 是（前端自動 re-login） |
| `liff-auth` | LINE verify 逾時/5xx | 503 | 回 `{message:'LINE 驗證服務暫時無法使用', violationType:'UNAUTHENTICATED'}`（ASM-12；沿用既有 enum 以符合 api.yml schema），前端顯示重試 | 是 |
| `liff-auth` | sub 不在白名單 | 403 | `FORBIDDEN` | 是 |
| `http/schemas` | 參數錯 | 400 | `INVALID_ARGUMENT`，message 指出欄位 | 是 |
| `transaction-service` | 分類不符 | 400 | `CATEGORY_MISMATCH` | 是 |
| `transaction-service` | 紀錄/分類不存在 | 404 | `NOT_FOUND` | 是 |
| `category-service.create` | 同名（含 P2002 併發） | 409 | `DUPLICATE_NAME` | 是 |
| `category-service.delete` | 刪「其他」 | 422 | `FALLBACK_CATEGORY_UNDELETABLE` | 是 |
| `category-service.delete` | 找不到同組「其他」（資料損壞） | 500 | rollback、log error | 是（「系統錯誤」） |
| `error-handler` | 未預期例外 | 500 | 回 `{message:'系統錯誤'}`，不洩漏 stack，log error | 是 |
| `config/env` | 缺必要 env / 格式錯 | 啟動失敗 | process exit 1，列出缺漏 key（不印值） | 否（部署 healthz 失敗 → 回滾） |
| `server.ts` | SIGTERM | 關機 | 停止接受連線、等待進行中請求（≤10s）、`prisma.$disconnect()` | 否 |
| `cli/seed-defaults` | DB 不可達 | 部署失敗 | exit 1 → deploy.sh 中止 | 否（CI 顯示失敗） |
| `deploy.sh` | migrate 失敗 | 部署失敗 | exit 非 0，不切換容器 | 否（GitHub Actions 失敗通知） |
| `deploy.sh` | healthz 逾時 | 部署失敗 | 以 `.last_good_tag` 回滾並 exit 1 | 否（Actions 失敗通知） |
| 前端 API 呼叫 | 401 | — | `liff.login()` 重新登入後重試一次 | 是 |
| 前端 API 呼叫 | 4xx 業務錯誤 | — | 依 violationType 顯示中文訊息 | 是 |
| 前端 API 呼叫 | 網路/5xx | — | ErrorBanner + 重試按鈕；表單保留輸入 | 是 |

> 檢查結果：無「處理方式=無 且 靜默」的 CRITICAL GAP。Reply API 失敗為唯一「使用者看不到回覆」路徑，已有 log 且資料可於 LIFF 查得。

## 失敗模式登記表

| 程式碼路徑 | 失敗模式 | 已處理? | 有測試? | 使用者可見? | 恢復路徑 |
|-----------|---------|--------|--------|-----------|---------|
| follow 重複事件（封鎖→解封） | 重複 seed | 是（只在 0 分類時 seed + unique） | BDD 加入好友 R3 | 否 | — |
| 擁有者在 webhook 設好前就加了好友 | 無分類 | 是（部署時 `seed-defaults`；文字記帳遇 0 分類也 ensure，ASM-08） | 單元 + 部署 smoke | 否 | 自動 |
| 雙擊分類按鈕（併發） | 重複記帳 | 是（PK + P2002 → 此筆已記帳） | BDD（已用 token）+ service 單元（模擬 P2002） | 是 | — |
| 點舊訊息上的刪除按鈕 | 紀錄已刪 | 是 | BDD 請求/確認刪除 | 是 | — |
| LIFF 刪除與 LINE 刪除同時 | 第二次 404 | 是（P2025 → NOT_FOUND） | service 單元 | 是 | 重新整理列表 |
| 編輯時帳本改了但分類沒改 | 分類不符 | 是（CATEGORY_MISMATCH） | BDD 編輯 | 是 | 前端換帳本時清空分類選擇 |
| 刪分類時其他分類遺失 | 無處歸類 | 是（partial unique + fallback 不可刪 + 交易內檢查） | BDD + migration 測試 | 是 | 手動修資料 |
| Quick Reply 分類 > 13 | LINE API 400 | 是（ASM-06） | 單元 | 否 | — |
| Postback data > 300 | LINE API 400 | 是（ASM-05） | 單元 | 是 | 縮短備註 / 改用表單 |
| 時區：23:30 台北記帳 | 日期記成前一天 | 是（Clock + Taipei） | 單元（UTC 15:30 邊界） | 否 | — |
| 月底 10-31 紀錄 | 落入 11 月 | 是（半開區間） | BDD 列表 / 摘要 | 否 | — |
| ID token 過期 | 401 | 是（re-login） | 前端單元（MSW 回 401） | 是（短暫） | 自動 |
| LIFF 深層連結參數遺失 | 圖表顯示錯月 | 是（init 後才 render） | 前端單元 | 是 | — |
| LINE verify API 不穩 | LIFF 全部失敗 | 是（503 + 快取） | http 單元（stub 逾時） | 是 | 重試 |
| Migration 失敗 | 新版無法上線 | 是（不切換） | CI 對 service DB 跑 migrate | 否 | 修 migration 重新 push |
| 新版啟動失敗 | 服務中斷 | 是（healthz + 回滾） | 部署 smoke（CI 跑容器） | 短暫 | 自動回滾 |
| 共用 Postgres 不可用 | 全部 500 / healthz 失敗 | 部分（healthz 回 503、log） | http 單元 | 是 | 共用環境負責 |
| secrets 外洩（log） | 資安 | 是（pino redact） | 單元（logger redact 測試） | 否 | 輪替 secret |

---

## 實作步驟

> 每個階段結束都必須通過**驗證關卡**：`npm run typecheck && npm run lint && npm run test:unit && npm run test:bdd`（P8 加 `npm run test:web`、P2/P9 加部署 smoke）。關卡失敗不得進入下一階段。每階段完成後在 `plans/line-accounting/.progress.json` 記錄 `{ phase, status, commit }` 以便中斷恢復。

### 第 0 階段（P0）：專案骨架與測試基礎建設｜複雜度：中｜風險：中

1. **Repo 基本設定**（檔案：`.gitattributes`、`.gitignore`、`.editorconfig`、`.nvmrc`、`.env.example`）
   - 行動：`* text=auto eol=lf`；`.nvmrc` 寫 `20`（R1 待確認）；`.env.example` 列出所有 env（見 runbook §5）。
   - 依賴：無｜風險：低
2. **package.json 與工具鏈**（`package.json`、`tsconfig.json`、`tsconfig.build.json`、`eslint.config.js`、`.prettierrc.json`、`vitest.config.ts`、`cucumber.cjs`）
   - 行動：dependencies `express`、`@line/bot-sdk`、`@prisma/client`、`prisma`（**放 dependencies**，執行期 migrate 需要）、`zod`、`pino`、`pino-http`、`helmet`；dev：`typescript`、`tsx`、`vitest`、`supertest`、`@cucumber/cucumber`、`@testcontainers/postgresql`、eslint/prettier。全部 `-E` 鎖精確版。
   - scripts：`dev`、`build`（tsc -p tsconfig.build.json）、`typecheck`、`lint`、`test:unit`（vitest run tests/unit tests/http）、`test:bdd`（cucumber-js）、`test:bdd:dry`、`test:web`（`npm --prefix web test`）、`test`（全部）、`db:migrate:dev`、`db:migrate:deploy`、`seed:defaults`、`richmenu:setup`。
   - `cucumber.cjs`：`paths: ['specs/features/**/*.feature']`、`requireModule: ['tsx/cjs']`、`require: ['tests/bdd/support/**/*.ts','tests/bdd/steps/**/*.ts']`、`format: ['progress-bar','html:reports/cucumber.html']`。**規格不搬移**，直接讀 `specs/features`。
   - 依賴：1｜風險：中（tsx + cucumber ESM/CJS 相容 → 統一 CommonJS）
3. **Prisma schema 與 init migration**（`prisma/schema.prisma`、`prisma/migrations/<ts>_init/migration.sql`）
   - 行動：依 `erm.dbml` 建 enum `Ledger/EntryType/EntrySource`（`@@map` 小寫 snake）、4 張表、索引、`category_keywords.category_id onDelete: Cascade`、`postback_tokens.transaction_id onDelete: SetNull`、`updated_at @updatedAt`。以 `prisma migrate dev --create-only` 產生後**手動追加**：
     ```sql
     CREATE UNIQUE INDEX categories_one_fallback ON categories (ledger, entry_type) WHERE is_fallback;
     ALTER TABLE transactions ADD CONSTRAINT transactions_amount_positive CHECK (amount > 0);
     ```
   - 依賴：2｜風險：中（R12）
4. **Dev DB**（`docker-compose.dev.yml`）
   - 行動：`postgres:16`（與共用環境主版號一致，**需確認共用 PG 版本**）、port 5433、volume。
   - 依賴：無｜風險：低
5. **設定與 app factory**（`src/config/env.ts`、`src/app.ts`、`src/server.ts`、`src/db/prisma.ts`、`src/db/date-only.ts`、`src/ports/*.ts`、`src/adapters/system-clock.ts`、`src/http/middleware/{error-handler,request-logger}.ts`、`src/http/routes/health.ts`、`src/domain/errors.ts`、`src/domain/enums.ts`）
   - 行動：`createApp(deps)` 掛 helmet、request-logger、`/healthz`（`SELECT 1`，失敗 503）、error-handler；`server.ts` 處理 SIGTERM。env 以 zod 驗證（見 runbook §5）。
   - 依賴：2,3｜風險：低
6. **BDD 基礎建設**（`tests/bdd/support/{world,hooks,db,table-mappers,line-event-factory,stubs}.ts`、`tests/bdd/steps/common/*.steps.ts`）
   - 行動：見 `test-strategy.md` §3。BeforeAll 啟 Testcontainers（或用 `TEST_DATABASE_URL`）→ `prisma migrate deploy`；Before `TRUNCATE … RESTART IDENTITY CASCADE`；World 注入 FixedClock / RecordingLineGateway / StubIdTokenVerifier。實作共用句型 G1、G2、G3、G4、G5、G6、G7、T1、T1n、T2、T3、T4、T5、T9、T10。
   - 依賴：5｜風險：中（R13、R16）
7. **Health / 驗簽 HTTP 測試骨架**（`tests/http/health.test.ts`）
   - 依賴：5｜風險：低

**成功標準**：`npm run test:bdd:dry` 列出 14 個 feature、只剩各 domain 專屬 step 為 undefined；`/healthz` 測試綠；`npx prisma migrate deploy` 對空 DB 成功。

### 第 1 階段（P1）：Webhook 骨架 + 加入好友｜複雜度：中｜風險：中

1. **webhook 路由與驗簽**（`src/line/webhook-route.ts`）— `express.raw`、`validateSignature`；簽章錯 401；`events: []` 回 200（LINE console「Verify」用）。依賴 P0｜風險：中（R7）
2. **事件分派與白名單**（`src/line/event-dispatcher.ts`）— 事件逐一處理、單事件 try/catch；`source.type !== 'user'` 忽略（ASM-11）；非白名單：follow/message 回不開放、postback 不回。
3. **LINE gateway**（`src/adapters/line-messaging-gateway.ts`、`src/ports/line-reply-gateway.ts`）— 介面 `reply(replyToken, messages: LineMessage[])`；domain 用自有 `LineMessage` 型別（text / textWithQuickReply / buttons / confirm），adapter 轉 SDK 型別。
4. **預設分類與 onboarding**（`src/domain/default-categories.ts`、`src/services/onboarding-service.ts`、`src/repositories/category-repository.ts`、`src/line/handlers/follow-handler.ts`、`src/line/messages/texts.ts`）— `ensureDefaultCategories()`：交易內 `count()==0` 才 `createMany({skipDuplicates:true})`。
5. **CLI seed**（`src/cli/seed-defaults.ts`）— 呼叫同一 service，冪等。
6. **測試**：BDD `access/加入好友.feature`（step：`"<userId>" 加入好友`、`分類應為空`）；`tests/http/webhook-signature.test.ts`（缺簽章/錯簽章 → 401 且 gateway 未被呼叫、DB 無寫入；空 events → 200）。

**成功標準**：加入好友 4 scenarios 綠；簽章測試綠。

### 第 2 階段（P2）：部署 Walking Skeleton（提前上線驗證 LINE 串接）｜複雜度：高｜風險：高

> 提前到此處的理由：Provider/userId、HTTPS、共用網路、DB 權限、migrate 流程是本專案最大的未知；在只有 follow 功能時就打通，後續每階段都能真機驗證。

1. **Dockerfile / .dockerignore**（runbook §2）
2. **deploy/compose.yml、deploy/Caddyfile.snippet、deploy/deploy.sh、deploy/sql/create-database.sql**（runbook §3、§4、§7）
3. **.github/workflows/ci.yml、deploy.yml**（runbook §6）
4. **VPS 一次性設定**（runbook §8 清單；需使用者在 VPS 操作）
5. **LINE 設定（第一批）**：Messaging API channel webhook URL = `https://<domain>/webhook/line`、Verify 成功、關閉自動回應訊息/歡迎訊息、關閉 redelivery。
6. **驗證**：真機加好友 → 收到歡迎訊息；`docker logs` 可見 userId；比對 `LINE_OWNER_USER_ID`。

**成功標準**：push main → Actions 綠 → `https://<domain>/healthz` 200 → 真機加好友收到歡迎訊息且 DB 有 19 個分類；刻意推一個壞版本（healthz 失敗）能自動回滾（可在 staging tag 演練一次）。

### 第 3 階段（P3）：LINE 文字記帳 + 分類按鈕｜複雜度：高｜風險：中

1. **文字解析器**（`src/domain/text-entry-parser.ts`）— 規則：
   - 先 `normalize('NFKC')`（全形數字/＋/全形空白轉半形，ASM-01）→ trim → 以 `/\s+/` 切詞。
   - 完全等於 `本月/上月/公 本月/公 上月` → `{kind:'summary'}`（由 dispatcher 先判斷）。
   - 首詞為 `公` 且後面還有詞 → company，移除；（`公` 單獨 → 格式錯）。
   - 下一詞以 `+` 開頭 → income，去掉 `+`；去掉後為空 → 格式錯。
   - 需至少「項目、金額」兩詞；金額詞符合 `/^[+-]?\d+(\.\d+)?$/` 但非正整數 → `AMOUNT_INVALID`；不符數字 → `FORMAT`；其餘詞以單一空白 join 為備註（保留「和同事 聚餐」）。
   - 回傳 discriminated union：`entry | summary | formatError | amountError | amountTooLarge | itemTooLong`。
2. **分類比對**（`src/services/category-matcher.ts`）— 同 ledger×type：名稱完全相等優先 → 關鍵字。
3. **postback codec**（`src/domain/postback-codec.ts`）— `encodePick/encodeDelete/encodeConfirm/encodeCancel`、`decode(data)`（URLSearchParams + zod）；只跳脫 `% & = +`；`assertWithinLimit(300)`。token：`crypto.randomBytes(9).toString('base64url')`（12 字元）。
4. **回覆 builder**（`src/line/messages/entry-replies.ts`）— 已記帳摘要 `已記帳｜{帳本}｜{收支}｜{項目} {金額} 元｜分類：{分類}｜{日期}` + 「刪除」postback（buttons template，altText 同文字前 400 字）；分類選擇 `請選擇「{項目} {金額} 元」的分類` + Quick Reply（ASM-06；`displayText` = 分類名）。
5. **transaction-service.createFromText / completePick**（`src/services/transaction-service.ts`、`src/repositories/{transaction,keyword,postback-token}-repository.ts`）— completePick 單一 `prisma.$transaction`：token 查重 → 分類驗證 → insert token → insert tx → `token.transaction_id` 更新 → 非 fallback 時 upsert keyword。
6. **handlers**（`src/line/handlers/text-message-handler.ts`、`postback-handler.ts` 的 pick 分支）。
7. **測試**：BDD `以文字訊息記帳`（18 例）、`選擇分類完成記帳`（7 例）；單元 `text-entry-parser.test.ts`（含 NFKC、全形空白、多空白、備註含空白、`+` 單獨、超長）、`postback-codec.test.ts`（往返、含 `&=+%` 的備註、300 邊界）、`entry-replies.test.ts`（13/20 字上限）、`transaction-service.pick.test.ts`（模擬 P2002 → 此筆已記帳）。

**成功標準**：兩個 feature 全綠；真機可文字記帳、選分類後下次自動歸類。

### 第 4 階段（P4）：LINE 刪除流程｜複雜度：低｜風險：低

1. `postback-handler` 的 `delete`（confirm template：`確定刪除？{項目} {金額} 元（{日期}）`，按鈕「確定/取消」）、`delete_confirm`（刪除 → `已刪除：…`；P2025 → 此紀錄已不存在）、`delete_cancel`（`已取消刪除`；紀錄不存在時仍回「此紀錄已不存在」）。
2. `transaction-service.deleteById`。
3. **測試**：BDD `請求刪除記帳紀錄`（3）、`確認刪除記帳紀錄`（4）；單元：id 非數字 → 視為不存在。

**成功標準**：兩個 feature 全綠。

### 第 5 階段（P5）：月度文字摘要｜複雜度：中｜風險：低

1. **date-utils**（`src/domain/date-utils.ts`）— `todayInTaipei(now)`、`parseMonth('YYYY-MM')`、`previousMonth`、`monthRange(month) → [startDate, nextStartDate)`。
2. **monthly-report**（`src/domain/monthly-report.ts`）— 輸入彙總列 → `{incomeTotal, expenseTotal, balance, expenseByCategory[{categoryId, categoryName, amount, ratio}]}`；`ratio = Math.round(amount*1000/expenseTotal)/10`；排序金額降冪、同額 categoryId 升冪（ASM-09）。
3. **report-service**（`src/services/report-service.ts`）— `prisma.transaction.groupBy({by:['entryType','categoryId'], _sum:{amount}})` + 分類名稱 join。
4. **summary builder**（`src/line/messages/summary-replies.ts`）— 文字格式（ASM-02，test 以此解析）：
   ```
   【個人】2026-11 月度摘要
   收入合計：50000 元
   支出合計：400 元
   結餘：49600 元
   支出分類：
   ・餐飲 300 元（75.0%）
   ・其他 100 元（25.0%）
   ```
   無支出時省略「支出分類：」區塊。第二則訊息為 buttons template「查看圖表」URI action → `https://liff.line.me/{LIFF_ID}/chart?month=2026-10&ledger=company`。
5. **測試**：BDD `查詢月度文字摘要`（10 例）；單元 `monthly-report.test.ts`（66.7/33.3、0 支出、負結餘、同額排序）、`date-utils.test.ts`（一月上月、UTC 15:59/16:00 邊界）。

**成功標準**：feature 全綠；Rich Menu 前可手打「本月」測試。

### 第 6 階段（P6）：LIFF 驗證 + 分類 API｜複雜度：中｜風險：中

1. **ID token verifier**（`src/adapters/line-id-token-verifier.ts`）— `POST https://api.line.me/oauth2/v2.1/verify`（form：`id_token`、`client_id=LINE_LOGIN_CHANNEL_ID`）；timeout 3s；成功結果以 token SHA-256 為 key 快取至 `exp`（上限 500 筆）；400 → `InvalidToken`；逾時/5xx → `VerifierUnavailable`。
2. **liff-auth middleware**（`src/http/middleware/liff-auth.ts`）。
3. **category routes / service / schemas**（`src/http/routes/categories.ts`、`src/services/category-service.ts`、`src/http/schemas/category.ts`、`src/http/mappers.ts`）— list 排序：`isFallback ASC, id ASC`；create：name trim、空 → 400、P2002 → 409；delete：交易內找 fallback → `updateMany` 紀錄 → delete（關鍵字 cascade）。
4. **測試**：BDD `查詢分類列表`（5）、`新增分類`（10）、`刪除分類`（5）；http 單元 `liff-auth.test.ts`（無 header、verifier 逾時 → 503、快取命中不再呼叫）。

**成功標準**：3 個 feature 全綠。

### 第 7 階段（P7）：記帳 CRUD API + 月度統計 API｜複雜度：中｜風險：低

1. **transaction schemas**（`src/http/schemas/transaction.ts`）— `ledger`/`entryType` enum、`item` trim 1–50、`amount` `z.number().int().min(1).max(99_999_999)`、`categoryId` int、`occurredOn` 正規 + 真實日期檢查（`2026-02-30` 失敗）、`note` 可空（空字串 → null）。
2. **routes**（`src/http/routes/transactions.ts`、`src/http/routes/reports.ts`）與 service 方法 `create/update/delete/listByMonth`（排序 `occurredOn DESC, id DESC`）、`report-service` 重用。
3. **測試**：BDD `查詢記帳紀錄列表`（8）、`以表單記帳`（17）、`編輯記帳紀錄`（8）、`刪除記帳紀錄`（4）、`查詢月度統計圖表`（11）。

**成功標準**：全部 14 個 feature 綠；`api.yml` 回應結構以 http 單元抽查（status code 201/204）。

### 第 8 階段（P8）：LIFF 前端｜複雜度：高｜風險：中

1. **web 骨架**（`web/package.json`、`vite.config.ts`（`base: '/liff/'`、dev proxy `/api` → 3000）、`index.html`、`tsconfig.json`、`vitest.config.ts`、`src/test/*`）— 參考 `aibdd-auto-tdd` 前端 starter（Vitest + RTL + MSW v2）。
2. **LIFF 封裝**（`web/src/liff/liff-client.ts`、`web/src/main.tsx`）— 先 `fetch('/liff/config.json')` 取 liffId → `liff.init` → 未登入 `liff.login()` → render。開發模式可用 `@line/liff-mock`（ASM-13）。
3. **API client**（`web/src/api/*`）— zod 解析回應；Authorization 自動帶 ID token；401 → `liff.login()`；錯誤轉中文（violationType 對照表）。
4. **頁面**：
   - `TransactionListPage`（`/liff/`）：MonthPicker + LedgerToggle；列表日期新到舊；每列點擊 → 編輯；刪除 → ConfirmDialog → DELETE → invalidate；空狀態「本月尚無紀錄」。
   - `TransactionFormPage`（`/liff/new`、`/liff/edit/:id`）：帳本/收支切換時重新載入分類並**清空已選分類**；日期預設今天（Taipei）；送出中 disable 按鈕（防重複點擊）；成功後返回列表（若在 LINE 內且為 `/new` 由 Rich Menu 開啟，可 `liff.closeWindow()`，ASM-14）。
   - `CategoryPage`（`/liff/categories`）：帳本×收支分頁；新增（trim、409 顯示「名稱重複」）；刪除一般分類前確認並提示「紀錄將改歸其他」；「其他」不顯示刪除鈕。
   - `ChartPage`（`/liff/chart?month&ledger`）：Recharts 收支長條 + 支出圓餅 + 分類明細表；無支出顯示「本月無支出」。
5. **Express 靜態服務**（`src/http/routes/liff-static.ts`）— `/liff/config.json`、`/liff/assets/*`（immutable 快取）、`/liff/*` SPA fallback（`index.html` no-cache）；helmet CSP 允許 `https://*.line-scdn.net`、`https://api.line.me`、`https://access.line.me`。
6. **測試**：`web/src/**/*.test.tsx`（見 test-strategy §5）；`tests/http/liff-static.test.ts`。

**成功標準**：`npm run test:web` 綠；`npm --prefix web run build` 成功；真機 LIFF 四頁可用。

### 第 9 階段（P9）：上線收尾（Rich Menu、LIFF 設定、驗收）｜複雜度：低｜風險：中

1. **Rich Menu**（`src/cli/setup-rich-menu.ts`、`deploy/rich-menu/rich-menu.png`）— 2×3：本月摘要（message「本月」）、上月摘要（message「上月」）、記帳表單（uri `/new`）、紀錄列表（uri `/`，ASM-15 補第 6 格）、圖表（`/chart`）、分類管理（`/categories`）。腳本冪等：刪除舊的同名 rich menu 後建立並設為預設。以 `docker compose run --rm line-accounting node dist/cli/setup-rich-menu.js` 執行。
2. **LIFF app 設定**：endpoint `https://<domain>/liff/`、size Full、scope `openid`（+ `profile` 可選）、Bot link feature On（Aggressive）。
3. **驗收**：手機走完 runbook §9 驗收清單。

**成功標準**：驗收清單全部打勾。

---

## 測試策略（摘要；詳見 `test-strategy.md`）

- **單元測試（Vitest）**：`src/domain/*`（parser、codec、date-utils、monthly-report、default-categories）、`src/line/messages/*`、`src/config/env.ts`、logger redact。
- **HTTP 測試（Vitest + supertest）**：webhook 簽章 401、空 events 200、healthz、liff-auth 邊界、liff-static、錯誤格式。
- **BDD 驗收（Cucumber.js 10 + tsx + supertest + PostgreSQL）**：14 個 feature 直接從 `specs/features` 執行；LINE Reply API、LINE verify API、時鐘以 stub 注入。
- **前端（Vitest + RTL + MSW v2）**：四頁的 happy / empty / error / 401 / 重複送出。
- **部署 smoke（CI）**：建置映像 → 對 service Postgres 跑 `migrate deploy` + `seed:defaults` → 啟動容器 → `curl /healthz`。
- **手動 E2E**：真機驗收清單（LINE 平台無法於 CI 自動化）。
- **指令**：`npm run test:unit`、`npm run test:bdd`、`npm run test:web`、`npm test`（全部）。
- **關鍵邊界**：金額 0/-1/12.5/1/99,999,999/超上限；日期 2026-02-30、2026-13-01；月份 2026-13、202611；10-31/11-01；一月查上月；佔比 66.7/33.3；Quick Reply 13 個；postback 300 字元；雙擊；Taipei 午夜。

## 依賴項目

| 類別 | 項目 |
|------|------|
| Runtime | Node.js 20（R1 建議 22/24）、PostgreSQL（共用，版本需確認，建議 ≥ 14） |
| 後端套件 | express 4.21、@line/bot-sdk（v9+，`messagingApi.MessagingApiClient`）、@prisma/client + prisma（6.x 鎖版）、zod 3、pino、pino-http、helmet |
| 測試 | vitest、supertest、@cucumber/cucumber 10、@testcontainers/postgresql、tsx |
| 前端 | vite、react 18、react-router、@tanstack/react-query、recharts、@line/liff 2.x、zod、msw 2、@testing-library/* |
| 外部服務 | LINE Messaging API、LINE Login（LIFF）、GitHub Actions、GHCR |
| 基礎設施 | VPS 共用 Docker Compose（Caddy、PostgreSQL）、網域 DNS |

## 風險與緩解措施（彙整）

- **高**：R2 Provider 不同導致 userId 不符 — 同一 Provider 建兩個 channel；P2 真機比對。
- **高**：R1 Node 20 EOL — 待使用者確認升 22/24，版本集中管理。
- **高**：共用環境結構未知（網路名稱、Caddyfile 載入方式、PG 版本）— P2 前執行 runbook §8「現況盤點」；compose 以外部網路接入，不修改他人服務。
- **中**：R4/R5 LINE 訊息上限 — codec/builder 有長度保護與單元測試。
- **中**：R11 日期時區 — 統一字串日期 + Clock；邊界測試。
- **中**：R18 migration 不可逆 — expand/contract 原則 + 部署前備份步驟。
- **低**：R16 Windows 開發差異 — `.gitattributes`、`TEST_DATABASE_URL`。

## 錯誤處理策略

- **兩種入口兩種語意**：Webhook 一律 HTTP 200（簽章錯除外），業務結果走 Reply 訊息；LIFF API 走 HTTP status + `{message, violationType}`。
- **DomainError 單一來源**：service 拋 `DomainError(violationType)`；LIFF 由 error-handler 映射 HTTP code；LINE handler 映射成規格文字（`texts.ts` 集中）。
- **資料一致性靠 DB**：唯一約束（分類名、關鍵字、token PK、partial fallback index）+ 交易；應用層檢查只是提早回饋，P2002/P2025 一律轉為對應業務錯誤。
- **外部呼叫**：LINE Reply 不重試（token 一次性）；LINE verify 3s timeout + 快取；全部錯誤 log 結構化並 redact 機敏欄位。

## 限制條件（此計劃不做的事）

- 不做多使用者、多幣別、收據照片、預算/提醒、匯出 CSV、軟刪除/復原。
- 不自帶 Caddy、PostgreSQL、備份；不修改共用環境中其他應用的服務定義（只新增網路連結與 Caddy site 片段）。
- 不在 CI 自動化 LINE 真機 E2E；不做 Push API（只用 Reply API，避免訊息費用）。
- 不實作 webhook redelivery 去重（關閉 redelivery 代替）。
- 不修改 `specs/` 中既有規格；若實作中發現規格矛盾，回報 clarifier，不自行改規格。
- planner 不寫程式碼；本計劃交由 tdd-coordinator 產出 Red→Green→Refactor 藍圖。

## 假設與待確認事項

| ID | 內容 | 狀態 |
|----|------|------|
| ASM-01 | 文字先 NFKC 正規化（全形數字、＋、全形空白可用） | 直接採用 |
| ASM-02 | 月度摘要文字格式如 P5；金額不加千分位（與規格「120 元」一致） | 直接採用 |
| ASM-03 | 金額上限 99,999,999（LINE 回「金額超過上限」，LIFF 回 INVALID_ARGUMENT） | 直接採用 |
| ASM-04 | 項目 > 50 字回「項目最多 50 字」 | 直接採用 |
| ASM-05 | postback data > 300 字元回「備註太長，請縮短後重新傳送，或改用表單記帳」 | 直接採用 |
| ASM-06 | Quick Reply > 13 → 前 12 個一般分類 + 其他；label 截 20 字 | 直接採用 |
| ASM-07 | pick data 不合法回「資料格式錯誤，請重新記帳」 | 直接採用 |
| ASM-08 | 白名單文字記帳時若分類數為 0，先 ensureDefaultCategories；部署時也跑 seed | 直接採用 |
| ASM-09 | 佔比同額時依分類 id 升冪 | 直接採用 |
| ASM-10 | LINE console 關閉 webhook redelivery、自動回應、問候訊息 | 直接採用 |
| ASM-11 | 群組/聊天室事件忽略；非文字訊息（貼圖、圖片）由擁有者傳來時回格式說明 | 直接採用 |
| ASM-12 | LINE verify 逾時/5xx → HTTP 503，body `{message, violationType:'UNAUTHENTICATED'}` | 直接採用 |
| ASM-13 | 本機開發 LIFF 用 `@line/liff-mock`；另建「開發用」LINE channel 搭配 cloudflared/ngrok | 直接採用 |
| ASM-14 | 表單由 Rich Menu 開啟送出成功後回列表（不自動關閉視窗） | 直接採用 |
| ASM-15 | Rich Menu 第 6 格為「紀錄列表」 | 直接採用 |
| Q-1 | Node 20（EOL）是否改 22 或 24 LTS | **需使用者確認**（P0 前；預設照定案 20） |
| Q-2 | 共用環境：外部網路名稱、Caddyfile 是否 `import` 子檔、Postgres 版本與容器名、apps 目錄慣例 | **需使用者確認**（P2 前；runbook §8 盤點指令） |
| Q-3 | 網域/子網域（例如 `ledger.<domain>`） | **需使用者確認**（P2 前） |

## 成功標準

- [ ] 14 個 `.feature`（約 140 個 example）在 `npm run test:bdd` 全綠，無 undefined/pending step
- [ ] `npm run test:unit`、`npm run test:web` 全綠；domain 模組行覆蓋率 ≥ 90%
- [ ] `npm run typecheck`、`npm run lint` 無錯誤
- [ ] push main → CI → 部署 → `/healthz` 200，全程自動，失敗時自動回滾
- [ ] VPS 上本應用只有一個 app container，無對外 port；DB 為獨立 database/user
- [ ] 非白名單帳號真機測試：加好友/傳訊息收到「此服務不開放使用」，LIFF 顯示無權限
- [ ] 擁有者真機走完三條 activity（runbook §9 驗收清單）
- [ ] log 中無 channel secret / access token / ID token 明文

## 預估複雜度：高

（後端 BDD 約 140 個 example、LINE 平台整合限制多、共用基礎設施接入有未知數；以 10 個可獨立合併的階段分攤。）
