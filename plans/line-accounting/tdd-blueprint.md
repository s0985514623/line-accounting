# TDD 協調藍圖：LINE 記帳（P0–P9）

> 產出者：tdd-coordinator｜建立日期：2026-11-12｜模式：本地（非 CI）、純 sub-agent 鏈式委派
> 上游：`implementation-plan.md`（P0–P9）、`test-strategy.md`、`deployment-runbook.md`、`specs/`（14 個 .feature、erm.dbml、api.yml、句型.md）
> 本藍圖**不修改** planner 計劃；以下「覆寫」僅反映使用者已拍板的決策（Q-1、ASM 全採用）。

---

## 第 1 節：環境確認

### 1.1 環境

| 項目 | 狀態 | 對藍圖的影響 |
|------|------|-------------|
| CI / 本地 | 本地（`GITHUB_ACTIONS` 未設定） | 不自動建 PR；每階段 Green Gate 後保留變更，commit 時機見 §7 |
| Git | 已 `git init`，分支 `main`，**尚無任何 commit** | §1.4 前置：先建立基準 commit（specs + plans） |
| OS | Windows 11；主窗口 Bash 工具為 Git Bash | Gate 指令一律用 POSIX 語法；`.gitattributes` 強制 LF（R16） |
| Node | 本機目前 **v22.18.0** | **P0 開工前必須安裝 Node 24 LTS**（見 §1.3） |
| Docker | Docker 29.4.0（Docker Desktop） | BDD 測試 DB 使用 `docker-compose.dev.yml`（port 5434；5433 被他專案占用）；Testcontainers 為備援 |
| specs | 完整：14 個 `.feature`、`erm.dbml`、`api.yml`、4 份句型.md、系統抽象.md | 採**規格驅動 TDD 模式**；cucumber 直接讀 `specs/features/**`，**任何 agent 不得修改 `specs/`** |
| milestones | `specs/milestones/` 不存在 | §7 步驟 0（milestone 同步）略過 |
| CLAUDE.md / .claude/rules | 不存在 | 收尾由 doc-updater 首次建立 |

### 1.2 技術棧摘要（決定派發對象）

| 區塊 | 技術 | 派發 |
|------|------|------|
| 後端 | Node 24 + TypeScript + Express 4.21 + Prisma 6.x + PostgreSQL + zod + pino + @line/bot-sdk | `@zenbu-powers:nodejs-master` |
| 後端測試 | Vitest + supertest（unit / http）、Cucumber.js 10 + tsx（BDD） | `@zenbu-powers:test-creator` |
| LIFF 前端 | `web/` 獨立 package：Vite + React 18 + react-router + TanStack Query + Recharts + @line/liff 2.x + zod | `@zenbu-powers:react-master` |
| 前端測試 | Vitest + RTL + MSW v2 | `@zenbu-powers:test-creator` |
| 部署 | Dockerfile、GHCR、GitHub Actions、deploy.sh、Caddy 片段 | `@zenbu-powers:nodejs-master`（GitHub Actions 部分可改派 `@zenbu-powers:workflow-master`，選用） |
| 收尾 | 文件同步 | `@zenbu-powers:doc-updater` |

### 1.3 使用者決策覆寫（所有派發 prompt 必須附上）

**Q-1：Node 20 → Node 24 LTS**（取代計劃中所有 Node 20 敘述）

| 位置 | 計劃原文 | 本藍圖採用 |
|------|---------|-----------|
| `.nvmrc` | `20` | `24` |
| `package.json` | — | `"engines": { "node": ">=24 <25" }`；`@types/node` 鎖 24.x 精確版 |
| `Dockerfile` | `ARG NODE_VERSION=20` | `ARG NODE_VERSION=24`（`node:24-bookworm-slim`） |
| CI `setup-node` | `node-version-file: .nvmrc` | 不變（自動吃到 24） |
| Prisma | 6.x 鎖版 | 選擇**明確支援 Node 24 的最新 6.x**（P0 環境檢查 `npx prisma -v` 必須在 Node 24 下成功）；仍不採 7.x（R15） |

> `implementation-plan.md`、`deployment-runbook.md`、`execution-plan.md` 中殘留的「Node 20」敘述，由 §7 doc-updater 統一同步，**執行期間以本表為準**。

**ASM-01 ～ ASM-15：全部採用**，派發 prompt 中直接引用編號即可，agent 不得再詢問。

**Q-2（共用環境盤點）、Q-3（子網域）：未回答** → 只阻擋 **P2b**（見 §4 P2 拆分）。PostgreSQL 主版號暫定 `postgres:16`（dev / CI 一致），Q-2 回答後若不同，於 P2b 一併對齊（一行修改 + 重跑全套 Gate）。

### 1.4 開工前置（主窗口親做，一次性）

1. 安裝 Node 24 LTS（擇一：`winget install OpenJS.NodeJS.LTS`、nvm-windows `nvm install 24 && nvm use 24`、或 fnm），驗證：
   ```bash
   node -v   # 預期 v24.x
   npm -v    # 預期 11.x
   ```
2. `git -C /d/Dev/line-accounting config core.autocrlf false`（runbook §8-I）
3. 經使用者同意後建立基準 commit：`docs: 新增 LINE 記帳規格與實作計畫`（只含 `specs/`、`plans/`）
4. 確認 Docker Desktop 執行中：`docker info --format '{{.ServerVersion}}'`

---

## 0. 全域規則（每個階段都適用）

### 0.1 檔案所有權（避免互改）

| 路徑 | 擁有者 | 其他 agent |
|------|--------|-----------|
| `specs/**` | 無人（唯讀） | 發現規格矛盾 → 停手回報主窗口 → 主窗口找 clarifier |
| `tests/**`、`vitest.config.ts`、`cucumber.cjs`、`docker-compose.dev.yml`、`web/src/**/*.test.tsx`、`web/src/test/**`、`web/vitest.config.ts`、`scripts/smoke/**` | test-creator | master **不得修改測試斷言**；認為測試錯 → 回報主窗口，由主窗口重派 test-creator |
| `src/**`、`prisma/**`、`.env.example`、`Dockerfile`、`.dockerignore`、`deploy/**`、`.github/**` | nodejs-master | — |
| `web/**`（測試以外） | react-master | — |
| `package.json`（根） | P0 由 test-creator 建立；之後 test-creator 只可加 devDependencies／test scripts，nodejs-master 只可加 dependencies／非 test scripts | 新增套件一律 `npm i -E` 鎖精確版 |
| `plans/line-accounting/.progress.json` | 主窗口 | 每次 Green Gate 通過後寫入 `{ phase, status, commit }` |

### 0.2 測試 DB

- 本機一律用 `docker compose -f docker-compose.dev.yml up -d` 起的 Postgres（port 5434；5433 被他專案占用），提供**獨立的 test database**（BDD 會 TRUNCATE，不可與開發資料共用）。
- 所有 Gate 指令以下列前綴執行（Bash 工具的 shell 狀態不保留，每次呼叫都要帶）：
  ```bash
  cd /d/Dev/line-accounting && export TEST_DATABASE_URL=postgresql://test:test@localhost:5434/test
  ```

### 0.3 標準 Gate 指令

**Red Gate（BDD 部分）**——兩段都要跑：
```bash
# (a) 步驟必須全部已定義：輸出摘要中不得出現 "undefined"
npx cucumber-js <RED_PATHS> --dry-run 2>&1 | tail -5; echo "DRYRUN_EXIT=${PIPESTATUS[0]}"
# (b) 實跑必須失敗
npx cucumber-js <RED_PATHS> --strict 2>&1 | tail -60; echo "BDD_EXIT=${PIPESTATUS[0]}"
```
**Red Gate（單元部分）**：
```bash
npx vitest run <NEW_UNIT_FILES> 2>&1 | tail -60; echo "UNIT_EXIT=${PIPESTATUS[0]}"
```
Red 通過條件：(a) 無 undefined（step 已由 test-creator 實作）；(b) `BDD_EXIT≠0`、`UNIT_EXIT≠0`；失敗原因是**斷言失敗／HTTP 狀態不符／`Cannot find module '…/src/…'`**，而不是 `SyntaxError`、`Cannot find package`、`ECONNREFUSED`、migration 失敗。

**Green Gate（累積回歸）**：
```bash
npx prisma generate >/dev/null
npm run typecheck; echo "TYPECHECK_EXIT=$?"
npm run lint;      echo "LINT_EXIT=$?"
npm run test:unit 2>&1 | tail -25; echo "UNIT_EXIT=${PIPESTATUS[0]}"
npx cucumber-js <GREEN_PATHS> --strict 2>&1 | tail -25; echo "BDD_EXIT=${PIPESTATUS[0]}"
```
Green 通過條件：四個 EXIT 全部為 0；cucumber 摘要為 `N scenarios (N passed)`，無 undefined / pending / ambiguous / skipped。

### 0.4 失敗處理（全階段共用）

| 失敗模式 | 應對 | 上限 |
|---------|------|------|
| Red：無測試檔 | 重派 test-creator | 2 次 |
| Red：dry-run 有 undefined | 重派 test-creator 補 step（附 undefined snippet） | 2 次 |
| Red：測試全綠 | 斷言沒真正檢查行為，重派 test-creator 修正 | 2 次 |
| Red：環境錯（DB 連不上、套件缺、migration 壞） | 主窗口修環境（起 compose、`npm ci`、`prisma generate`）後重跑 | 2 次 |
| Green：目標測試仍失敗 | 重派同一 master，附完整失敗輸出 | 3 次 |
| Green：先前綠的測試變紅（回歸） | 重派同一 master，標明「回歸」與受影響 feature | 3 次（與上合計） |
| Green：master 主張「測試錯了」 | 主窗口比對 `.feature` 原文：測試與規格不符 → 重派 test-creator；規格本身矛盾 → 停止，找 clarifier | — |
| 次數耗盡 | 中止，保留現況，回報失敗清單給使用者 | — |

### 0.5 派發 prompt 共用前言（每次派發都貼在 prompt 開頭）

```
專案：D:\Dev\line-accounting（LINE 記帳，greenfield）。全程繁體中文。
必讀：plans/line-accounting/implementation-plan.md（本次只做〈第 X 階段〉）、
      plans/line-accounting/test-strategy.md、plans/line-accounting/tdd-blueprint.md §0 與 §1.3。
決策覆寫：Node 24 LTS（非 20）；ASM-01～ASM-15 全部採用，不再詢問。
禁止：修改 specs/**；修改不屬於你的檔案（見 tdd-blueprint.md §0.1）；新增套件未以 -E 鎖精確版。
回報：列出新增/修改的檔案絕對路徑、你自己跑過的命令與 EXIT_CODE；若發現規格矛盾，停手回報，不自行解讀。
```

---

## 階段總覽與建議順序

| 順序 | 階段 | 內容 | Red agent | Green agent | 可否平行 | 前置 |
|------|------|------|-----------|-------------|---------|------|
| 1 | **P0** | 骨架 + 測試基礎建設 | test-creator | nodejs-master | 否（一切的地基） | §1.4 |
| 2 | **P1** | Webhook 骨架 + 加入好友 | test-creator | nodejs-master | 否 | P0 |
| 3 | **P2a** | 映像與 CI（repo 端，不碰 VPS） | test-creator | nodejs-master | 可與 P3a 平行（檔案不重疊），預設序列 | P1 |
| 4 | **P3a** | 文字記帳 | test-creator | nodejs-master | 否 | P1 |
| 5 | **P3b** | 選擇分類完成記帳 | test-creator | nodejs-master | 否 | P3a |
| 6 | **P4** | LINE 刪除流程 | test-creator | nodejs-master | 否（同改 postback-handler） | P3b |
| 7 | **P5** | 月度文字摘要 | test-creator | nodejs-master | 否（同改 text dispatcher） | P3a（建議接 P4 後） |
| 8 | **P6** | LIFF 驗證 + 分類 API | test-creator | nodejs-master | 理論上可與 P3–P5 平行（需 worktree），**不建議**：共用 app.ts、mappers、steps/common | P0 |
| 9 | **P7** | 記帳 CRUD + 月度統計 API | test-creator | nodejs-master | 否 | P5、P6 |
| 10 | **P8.1** | LIFF 前端：骨架 + liff/api + 列表/表單頁 | test-creator | react-master | **可**：只動 `web/**`，P0 後即可以 worktree 與後端 lane 平行 | P0（api.yml） |
| 11 | **P8.2** | LIFF 前端：分類頁 + 圖表頁 | test-creator | react-master | 同上 | P8.1 |
| 12 | **P8.3** | Express 提供 LIFF 靜態檔 | test-creator | nodejs-master | 否（改 app.ts） | P7、P8.2 |
| 13 | **P2b** | VPS 部署 + LINE webhook 上線 | test-creator | nodejs-master + 使用者 VPS 操作 | — | **Q-2、Q-3 已回答**、P2a |
| 14 | **P9** | Rich Menu、LIFF 設定、真機驗收 | test-creator | nodejs-master + 使用者 | 否 | P2b、P8.3 |

**P2 的建議處理**
- 計劃原意是「越早打通真機越好」。因 Q-2／Q-3 未答，拆成：
  - **P2a（不受阻）**：Dockerfile、`.dockerignore`、`ci.yml`（含 image-smoke）、本機映像 smoke。放在 P1 之後立刻做，及早暴露 Node 24 + Prisma engine + bookworm-slim 的相容問題。
  - **P2b（受阻於 Q-2、Q-3）**：`deploy/compose.yml`、`Caddyfile.snippet`、`deploy.sh`、`sql/create-database.sql`、`deploy.yml`、VPS 一次性設定、LINE webhook 設定。
- **插入規則**：Q-2、Q-3 一旦回答，主窗口在**下一個階段邊界**（當前階段 Green Gate 通過後）插入 P2b，之後每階段都能真機驗證；最晚必須在 P9 之前完成。
- 若一直未答：照上表順序跑到 P8.3，P2b 移到 P9 前。

**預設執行方式**：完全序列（主窗口一次 spawn 一位）。若使用者想縮短時程，唯一建議的平行 lane 是「P8.1→P8.2 前端」在 P0 Green 後以 `isolation: "worktree"` 與後端 P1→P7 並行，P8.3 前合併回主線。

---

## 第 2～5 節：各階段 Red → Red Gate → Green → Green Gate

> 每個階段都依同一順序：**test-creator（Red）→ 主窗口 Red Gate → master（Green）→ 主窗口 Green Gate → 主窗口更新 `.progress.json`**。Red Gate 沒過，**不得** spawn master。

---

### P0：專案骨架與測試基礎建設

> 特殊性：P0 沒有業務行為。測試工具鏈本身由 test-creator 建立（屬測試基礎建設），**src/ 與 prisma/ 一行都不由 test-creator 寫**，維持「先紅後綠」。

#### 🔴 Red（spawn `@zenbu-powers:test-creator`）

**輸入檔案**：`implementation-plan.md` P0 步驟 1、2、4、6、7；`test-strategy.md` §1、§3、§4（G1–G7、T1、T1n、T2–T5、T9、T10）、§5（env、redact、health）、§6；`specs/entity/erm.dbml`；`specs/features/**`（只讀句型）；`deployment-runbook.md` §5（env 清單）、§8-I。

**派發 prompt 草稿**：
```
<§0.5 共用前言，〈第 0 階段〉>
任務：建立測試工具鏈與 P0 測試（Red），不得撰寫 src/** 或 prisma/**。
1. Repo 基本檔：.gitattributes（* text=auto eol=lf）、.gitignore、.editorconfig、.nvmrc（24）。
2. 根 package.json：依 implementation-plan P0-2 列出全部 dependencies / devDependencies（-E 鎖精確版；
   engines node >=24 <25；@types/node 24.x；Prisma 選明確支援 Node 24 的最新 6.x），以及計劃列出的全部 scripts
   （含 test:bdd:dry = cucumber-js --dry-run）。tsconfig.json、tsconfig.build.json、eslint.config.js、.prettierrc.json、
   vitest.config.ts（含 tests/unit、tests/http）、cucumber.cjs（paths 指向 specs/features、tsx/cjs、統一 CommonJS）。
   執行 npm install 產生 package-lock.json。
3. docker-compose.dev.yml：postgres:16、port 5433、獨立的 test database（user/pass/db = test/test/test）與 dev database。
4. BDD 基礎建設 tests/bdd/support/{world,hooks,db,table-mappers,line-event-factory,stubs}.ts（照 test-strategy §3；
   World 經 createApp(deps) 取得 app，import 自 src/app.ts——此時尚不存在，屬預期的紅燈）。
5. 共用 step：tests/bdd/steps/common/*.steps.ts 實作 G1–G7、T1、T1n、T2、T3、T4、T5、T9、T10，文字與 .feature 逐字一致（含全形「：」）。
6. 單元 / HTTP 測試：tests/unit/config/env.test.ts、tests/unit/logging/redact.test.ts、tests/unit/db/date-only.test.ts、
   tests/http/health.test.ts（DB 正常 200、DB 斷線 503）、tests/db/schema-constraints.test.ts
   （跑 prisma migrate deploy 後驗：同帳本×收支第二個 is_fallback=true 失敗；amount=0 違反 CHECK；category 刪除 cascade 關鍵字；
   刪除 transaction 使 postback_tokens.transaction_id 變 null）。tests/db 需納入 test:unit 或另設 test:db script（並寫入 test:unit 的執行範圍）。
7. 測試可透過 TEST_DATABASE_URL 指定 DB；未提供時才用 Testcontainers。
完成後自行跑：npm run test:unit（預期失敗，原因是 src 模組不存在）、npm run test:bdd:dry，貼出輸出。
```

**預期產出**：工具鏈設定檔、`package-lock.json`、`docker-compose.dev.yml`、`tests/bdd/support/*`（6 檔）、`tests/bdd/steps/common/*`、5 個單元／HTTP／DB 測試檔。

#### 🚨 Red Gate（主窗口親跑）

```bash
cd /d/Dev/line-accounting && export TEST_DATABASE_URL=postgresql://test:test@localhost:5434/test
node -v; npx prisma -v 2>&1 | head -3; echo "PRISMA_EXIT=${PIPESTATUS[0]}"     # 環境：Node 24、prisma CLI 可執行
docker compose -f docker-compose.dev.yml up -d; echo "COMPOSE_EXIT=$?"
ls tests/unit/config/env.test.ts tests/http/health.test.ts tests/db/schema-constraints.test.ts tests/bdd/support/world.ts
npm run test:unit 2>&1 | tail -40; echo "UNIT_EXIT=${PIPESTATUS[0]}"
```
- 通過：檔案存在；`PRISMA_EXIT=0`、`COMPOSE_EXIT=0`；`UNIT_EXIT≠0`，失敗原因為 `Cannot find module '../../src/...'`／缺 `prisma/schema.prisma`。
- `PRISMA_EXIT≠0` 或 Node 不是 24 → 環境錯，修環境（必要時退 test-creator 換 Prisma 6.x 版本號）。
- BDD 於 P0 不跑 Red（共用 step 依賴 src，Green Gate 才驗）。

#### 🟢 Green（spawn `@zenbu-powers:nodejs-master`）

**輸入檔案**：`implementation-plan.md` P0 步驟 3、5、R11–R14；`specs/entity/erm.dbml`；`deployment-runbook.md` §5.1；P0 測試檔。

**派發 prompt 草稿**：
```
<§0.5 共用前言，〈第 0 階段〉>
任務：讓 P0 測試轉綠，不得修改 tests/**。
1. prisma/schema.prisma 依 erm.dbml（enum @@map、4 表、索引、onDelete Cascade/SetNull、@updatedAt），
   以 prisma migrate dev --create-only 產生 init migration，再手動追加 partial unique index categories_one_fallback 與
   CHECK transactions_amount_positive（implementation-plan P0-3）。對 TEST_DATABASE_URL 的 DB 執行 migrate deploy 驗證。
2. src/config/env.ts（zod、缺 key 只列 key 不列值）、src/app.ts（createApp(deps)）、src/server.ts（SIGTERM graceful）、
   src/db/{prisma,date-only}.ts、src/ports/*.ts、src/adapters/system-clock.ts、src/http/middleware/{error-handler,request-logger}.ts
   （pino redact Authorization / x-line-signature / token）、src/http/routes/health.ts、src/domain/{errors,enums}.ts、.env.example。
3. 確保 cucumber 共用 step 能載入（dry-run 時 G1–G7、T1–T10 皆不為 undefined）。
完成後自行跑 §0.3 Green Gate（GREEN_PATHS 改用 dry-run 檢查），貼出 EXIT_CODE。
```

#### 🚨 Green Gate（主窗口親跑）

```bash
cd /d/Dev/line-accounting && export TEST_DATABASE_URL=postgresql://test:test@localhost:5434/test
DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy 2>&1 | tail -5; echo "MIGRATE_EXIT=${PIPESTATUS[0]}"
npm run typecheck; echo "TYPECHECK_EXIT=$?"
npm run lint; echo "LINT_EXIT=$?"
npm run test:unit 2>&1 | tail -25; echo "UNIT_EXIT=${PIPESTATUS[0]}"
npm run test:bdd:dry 2>&1 | tail -5; echo "DRYRUN_EXIT=${PIPESTATUS[0]}"
npx cucumber-js --dry-run --format snippets 2>&1 | grep -cE "白名單 LINE userId|今天為|系統中有以下|LIFF 請求身分為|回覆訊息應為|不回覆任何訊息|操作成功|操作失敗|記帳紀錄應為|分類應為|分類關鍵字應為|查詢結果應為"
```
- 通過：`MIGRATE_EXIT`、`TYPECHECK_EXIT`、`LINT_EXIT`、`UNIT_EXIT` 皆 0；dry-run 列出 14 個 feature；最後一行 grep 計數為 **0**（共用句型已全部定義，只剩各 domain 專屬 step 為 undefined）。`DRYRUN_EXIT` 可因 undefined 為非 0，不列入判定。

---

### P1：Webhook 骨架 + 加入好友

| 項目 | 內容 |
|------|------|
| RED_PATHS / GREEN_PATHS | `specs/features/access` |
| 新增單元／HTTP 測試 | `tests/http/webhook-signature.test.ts`、`tests/unit/domain/default-categories.test.ts`、`tests/unit/line/line-messaging-gateway.test.ts`（adapter：LineMessage → SDK 型別轉換、錯誤只 log 不拋） |
| BDD step | `steps/access/access.steps.ts`（W-follow `"<userId>" 加入好友`）、`steps/common/line.steps.ts`（W1、W2 webhook 送出器若 P0 尚未建） |

**🔴 Red prompt 草稿（test-creator）**
```
<§0.5 共用前言，〈第 1 階段〉>
任務：為 specs/features/access/加入好友.feature 實作缺少的 step（W-follow 等），並新增：
- tests/http/webhook-signature.test.ts：無簽章 401、錯簽章 401 且 gateway 未呼叫且 DB 無寫入、events: [] 200、非 JSON 400。
- tests/unit/domain/default-categories.test.ts：19 筆、每組帳本×收支恰一個 fallback。
- tests/unit/line/line-messaging-gateway.test.ts：domain LineMessage（text/textWithQuickReply/buttons/confirm）→ SDK 訊息格式；SDK 拋錯時只 log 不拋出。
- 非白名單 follow 回「此服務不開放使用」、群組事件忽略（ASM-11）若 feature 未涵蓋，補在 tests/http/event-dispatcher.test.ts。
dry-run 不得有 undefined；跑一次確認失敗原因為行為未實作。
```
**🚨 Red Gate**：§0.3，`RED_PATHS=specs/features/access`，`NEW_UNIT_FILES=tests/http/webhook-signature.test.ts tests/unit/domain/default-categories.test.ts tests/unit/line/line-messaging-gateway.test.ts`。

**🟢 Green prompt 草稿（nodejs-master）**
```
<§0.5 共用前言，〈第 1 階段〉>
任務：實作 implementation-plan P1 步驟 1–5（webhook-route 用 express.raw + validateSignature（R7）、event-dispatcher
單事件 try/catch、line-messaging-gateway、default-categories、onboarding-service.ensureDefaultCategories、follow-handler、
texts.ts、cli/seed-defaults.ts）。讓 access feature 與 P1 新測試全綠，且 P0 測試不得回歸。
```
**🚨 Green Gate**：§0.3，`GREEN_PATHS=specs/features/access`（預期 4 scenarios passed）。

---

### P2a：映像與 CI（repo 端，不受 Q-2/Q-3 阻擋）

| 項目 | 內容 |
|------|------|
| 測試 | `scripts/smoke/image-smoke.mjs`（Node 腳本，跨平台）：`docker build -t la:smoke .` → 對 compose dev DB 跑 `prisma migrate deploy`、`dist/cli/seed-defaults.js` → `docker run` → 輪詢 `/healthz` 30 次 → 驗 HTTP 200 且映像內 `node -v` 為 v24、容器以 `node` 使用者執行、映像不含 `.env`/`specs`/`tests` |
| Workflow 靜態檢查 | `docker run --rm -v "$(pwd -W):/repo" -w /repo rhysd/actionlint:1.7.7` |

**🔴 Red prompt 草稿（test-creator）**
```
<§0.5 共用前言，〈第 2 階段——僅 P2a：Dockerfile、.dockerignore、.github/workflows/ci.yml 與映像 smoke〉>
任務：建立 scripts/smoke/image-smoke.mjs（規格見 tdd-blueprint P2a），並新增 npm script "smoke:image"。
DB 使用 docker-compose.dev.yml 的 test DB（容器以 host.docker.internal:5433 連線，Windows Docker Desktop 適用）。
不得撰寫 Dockerfile 或 workflow。
```
**🚨 Red Gate**：
```bash
cd /d/Dev/line-accounting && npm run smoke:image 2>&1 | tail -20; echo "SMOKE_EXIT=${PIPESTATUS[0]}"
```
通過：`SMOKE_EXIT≠0`，原因為找不到 Dockerfile。

**🟢 Green prompt 草稿（nodejs-master）**
```
<§0.5 共用前言，〈第 2 階段——僅 P2a〉>
任務：依 deployment-runbook §2 建 Dockerfile（ARG NODE_VERSION=24、node:24-bookworm-slim、USER node、HEALTHCHECK）、.dockerignore，
依 §6.1 建 .github/workflows/ci.yml（backend / web / image-smoke 三個 job；web job 在 web/ 尚不存在時以 hashFiles 條件略過；
actions 全部釘 commit SHA；postgres:16 為暫定，註解標示待 Q-2 對齊）。
不建立 deploy.yml、deploy/**（屬 P2b，受 Q-2/Q-3 阻擋）。讓 npm run smoke:image 與 actionlint 通過。
```
**🚨 Green Gate**：
```bash
cd /d/Dev/line-accounting
npm run smoke:image 2>&1 | tail -20; echo "SMOKE_EXIT=${PIPESTATUS[0]}"
docker run --rm -v "$(pwd -W):/repo" -w /repo rhysd/actionlint:1.7.7; echo "ACTIONLINT_EXIT=$?"
# + §0.3 Green Gate，GREEN_PATHS=specs/features/access（確認無回歸）
```

---

### P3a：以文字訊息記帳

| 項目 | 內容 |
|------|------|
| RED_PATHS | `specs/features/transaction/以文字訊息記帳.feature` |
| GREEN_PATHS | `specs/features/access specs/features/transaction/以文字訊息記帳.feature` |
| 新增單元測試 | `tests/unit/domain/text-entry-parser.test.ts`、`tests/unit/domain/postback-codec.test.ts`、`tests/unit/line/entry-replies.test.ts`（案例照 test-strategy §5） |
| BDD step | `steps/transaction/line.steps.ts`（T7 分類按鈕、T8 按鈕；`$記帳紀錄.id` 解析） |

**🔴 Red prompt 草稿（test-creator）**
```
<§0.5 共用前言，〈第 3 階段——P3a：以文字訊息記帳〉>
任務：實作 T7、T8 等缺少的 step；新增 text-entry-parser、postback-codec、entry-replies 單元測試，
案例必須涵蓋 test-strategy §5 所列全部邊界（NFKC/ASM-01、全形空白、多空白、備註含空白、"+" 單獨、"公" 單獨、
項目 51 字/ASM-04、金額 100000000/ASM-03、摘要指令 4 種、postback 300/301 字元/ASM-05、Quick Reply 14 分類→13 且含其他/ASM-06、label 21 字截斷、altText ≤ 400）。
白名單文字記帳遇 0 分類時自動 seed（ASM-08）、擁有者傳非文字訊息回格式說明（ASM-11）若 feature 未涵蓋，補 http 或 service 層測試。
```
**🚨 Red Gate**：§0.3，`NEW_UNIT_FILES=tests/unit/domain/text-entry-parser.test.ts tests/unit/domain/postback-codec.test.ts tests/unit/line/entry-replies.test.ts`。

**🟢 Green prompt 草稿（nodejs-master）**
```
<§0.5 共用前言，〈第 3 階段——P3a〉>
任務：實作 implementation-plan P3 步驟 1–4、步驟 5 的 createFromText、步驟 6 的 text-message-handler
（parser、category-matcher、postback-codec（encodePick/encodeDelete）、entry-replies、keyword/transaction repository）。
pick 完成記帳（completePick）屬 P3b，本輪不做。
```
**🚨 Green Gate**：§0.3，GREEN_PATHS 如上。

### P3b：選擇分類完成記帳

| 項目 | 內容 |
|------|------|
| RED_PATHS | `specs/features/transaction/選擇分類完成記帳.feature` |
| GREEN_PATHS | P3a 的 GREEN_PATHS + `specs/features/transaction/選擇分類完成記帳.feature` |
| 新增單元測試 | `tests/unit/services/transaction-service.pick.test.ts`（模擬 P2002 → 「此筆已記帳」；分類錯誤時 token 不寫入；data 竄改 → ASM-07 文字） |

**Red / Green prompt 要點**：Red 同 P3a 範本（W2、G6、T1n、T9 已於 P0 建好，只補缺口）；Green 實作 `completePick`（單一 `prisma.$transaction`，順序：token 查重 → 分類驗證 → insert token → insert tx → 回填 token.transaction_id → 非 fallback 時 upsert keyword）與 postback-handler 的 pick 分支、`decode` + zod。
**Gate**：§0.3。

---

### P4：LINE 刪除流程

| 項目 | 內容 |
|------|------|
| RED_PATHS | `specs/features/transaction/請求刪除記帳紀錄.feature specs/features/transaction/確認刪除記帳紀錄.feature` |
| GREEN_PATHS | P3b 的 GREEN_PATHS + 上述兩檔 |
| 新增單元測試 | `tests/unit/line/delete-replies.test.ts`（confirm template 文字、按鈕 data）、`tests/unit/services/transaction-service.delete.test.ts`（id 非數字視為不存在、P2025 → 此紀錄已不存在） |

**Green 要點**：postback-handler 的 `delete` / `delete_confirm` / `delete_cancel` 分支、`transaction-service.deleteById`（implementation-plan P4）。
**Gate**：§0.3。

---

### P5：月度文字摘要

| 項目 | 內容 |
|------|------|
| RED_PATHS | `specs/features/report/查詢月度文字摘要.feature` |
| GREEN_PATHS | P4 的 GREEN_PATHS + `specs/features/report/查詢月度文字摘要.feature` |
| 新增單元測試 | `tests/unit/domain/date-utils.test.ts`、`tests/unit/domain/monthly-report.test.ts`、`tests/unit/line/summary-replies.test.ts`（案例照 test-strategy §5；摘要格式 ASM-02、同額排序 ASM-09） |
| BDD step | `steps/report/report.steps.ts`（T12、T13 LINE 分支、T14） |

**Green 要點**：implementation-plan P5 步驟 1–4；`report-service` 設計成 P7 LIFF 統計可直接重用。
**Gate**：§0.3。

---

### P6：LIFF 驗證 + 分類 API

| 項目 | 內容 |
|------|------|
| RED_PATHS | `specs/features/category` |
| GREEN_PATHS | P5 的 GREEN_PATHS + `specs/features/category` |
| 新增測試 | `tests/http/liff-auth.test.ts`（無 Authorization 401、verifier 逾時 503 且 body violationType=UNAUTHENTICATED/ASM-12、sub 非白名單 403、同 token 第二次不呼叫 verifier）、`tests/unit/adapters/line-id-token-verifier.test.ts`（以注入 fetch 驗：form 欄位 id_token/client_id=LINE_LOGIN_CHANNEL_ID、3s timeout、400→InvalidToken、5xx→VerifierUnavailable、快取上限 500） |
| BDD step | `steps/category/category.steps.ts`（W7–W9、T11） |

**Green 要點**：implementation-plan P6 步驟 1–3；刪除分類必須在單一交易內改歸「其他」後刪除。
**Gate**：§0.3。

---

### P7：記帳 CRUD API + 月度統計 API

| 項目 | 內容 |
|------|------|
| RED_PATHS | `specs/features/transaction/查詢記帳紀錄列表.feature specs/features/transaction/以表單記帳.feature specs/features/transaction/編輯記帳紀錄.feature specs/features/transaction/刪除記帳紀錄.feature specs/features/report/查詢月度統計圖表.feature` |
| GREEN_PATHS | `specs/features`（**全部 14 個 feature**） |
| 新增測試 | `tests/unit/http/transaction-schema.test.ts`（2026-02-30 失敗、空字串 note → null、金額 12.5/0/99,999,999/100,000,000）、`tests/http/api-contract.test.ts`（抽查 201/204、錯誤 body 形狀符合 api.yml） |
| BDD step | `steps/transaction/liff.steps.ts`（W3–W6）、`steps/report/report.steps.ts`（W10、T13 LIFF 分支、T15） |

**Green 要點**：implementation-plan P7 步驟 1–2；`listByMonth` 排序 `occurredOn DESC, id DESC`。
**Gate**：§0.3，另加：
```bash
npx cucumber-js --strict 2>&1 | tail -5     # 預期約 140 個 example 全數 passed（以實際輸出為準）
```

---

### P8.1：LIFF 前端（骨架、liff-client、API client、列表頁、表單頁）

| 項目 | 內容 |
|------|------|
| 所在目錄 | `web/`（獨立 package） |
| Red 產出 | `web/package.json`（-E 鎖版、engines node 24、scripts：dev/build/typecheck/test）、`vite.config.ts`（base `/liff/`、proxy `/api`）、`web/vitest.config.ts`、`web/tsconfig.json`、`web/index.html`、`web/src/test/{setup.ts,mocks/handlers.ts,mocks/server.ts}`（MSW handlers 依 `specs/api/api.yml` 回應形狀）、測試：`liff/liff-client.test.ts`、`api/http.test.ts`（401 → login、violationType → 中文）、`pages/TransactionListPage.test.tsx`、`pages/TransactionFormPage.test.tsx`（案例照 test-strategy §5） |
| Green agent | `@zenbu-powers:react-master` |

**🔴 Red prompt 草稿（test-creator）**
```
<§0.5 共用前言，〈第 8 階段——P8.1〉>
任務：在 web/ 建立前端測試工具鏈與 P8.1 測試（見 tdd-blueprint P8.1）。可參考 zenbu-powers:aibdd-auto-tdd 前端 starter
（Vitest + RTL + MSW v2）。MSW handlers 以 api.yml 為唯一依據。必測：R9（liff.init 完成前不 render router）、R10（401 → liff.login 後重試一次）、
雙擊送出只發一次請求、切換帳本/收支清空已選分類、編輯模式預填、網路錯誤保留輸入、CATEGORY_MISMATCH 中文訊息、空狀態「本月尚無紀錄」、
ASM-14（送出成功回列表，不呼叫 closeWindow）。開發用 @line/liff-mock（ASM-13）僅在 dev 使用。不得撰寫頁面/元件實作。
```
**🚨 Red Gate**：
```bash
cd /d/Dev/line-accounting && npm --prefix web ci; echo "CI_EXIT=$?"
npm --prefix web test 2>&1 | tail -40; echo "WEB_EXIT=${PIPESTATUS[0]}"
```
通過：`CI_EXIT=0`、`WEB_EXIT≠0`，原因為頁面/模組不存在或斷言失敗。

**🟢 Green prompt 草稿（react-master）**
```
<§0.5 共用前言，〈第 8 階段——P8.1〉>
任務：實作 web/src/main.tsx、App.tsx（react-router，basename /liff）、liff/liff-client.ts、api/{http,schemas,transactions,categories}.ts、
pages/{TransactionListPage,TransactionFormPage}.tsx 與所需 components（MonthPicker、LedgerToggle、EntryTypeToggle、CategorySelect、ConfirmDialog、ErrorBanner）。
技術棧以計劃為準：React 18 + react-router + TanStack Query + zod；不引入 Ant Design / Refine（計劃未指定 UI 套件，建議 CSS Modules）。
日期「今天」以 Asia/Taipei 計算。不得修改 *.test.tsx 與 web/src/test/**。
```
**🚨 Green Gate**：
```bash
cd /d/Dev/line-accounting
npm --prefix web run typecheck; echo "WEB_TYPECHECK_EXIT=$?"
npm --prefix web test 2>&1 | tail -25; echo "WEB_EXIT=${PIPESTATUS[0]}"
npm --prefix web run build 2>&1 | tail -10; echo "WEB_BUILD_EXIT=${PIPESTATUS[0]}"
```

### P8.2：LIFF 前端（分類頁、圖表頁）

| 項目 | 內容 |
|------|------|
| Red 產出 | `pages/CategoryPage.test.tsx`（「其他」無刪除鈕、空白名稱阻擋、409 名稱重複、刪除提示改歸其他）、`pages/ChartPage.test.tsx`（讀 `?month&ledger`、無參數預設本月個人、無支出「本月無支出」、400 顯示錯誤）、`api/reports.test.ts` |
| Green | react-master：`CategoryPage.tsx`、`ChartPage.tsx`（Recharts 長條 + 圓餅 + 明細表）、`api/reports.ts` |
| Gate | 同 P8.1 |

### P8.3：Express 提供 LIFF 靜態檔

| 項目 | 內容 |
|------|------|
| Red | test-creator：`tests/http/liff-static.test.ts`（`/liff/config.json` 回 liffId、`/liff/edit/3` fallback index.html 且 no-cache、`/liff/assets/*` immutable、CSP 含 `*.line-scdn.net`、`api.line.me`、`access.line.me`）；`image-smoke.mjs` 加驗 `GET /liff/` 200 |
| Green | nodejs-master：`src/http/routes/liff-static.ts`、helmet CSP、Dockerfile 加入 web build stage |
| Gate | §0.3（GREEN_PATHS=`specs/features`）+ `npm run smoke:image` + P8.1 前端 Gate |

---

### P2b：VPS 部署與 LINE webhook 上線（前置：Q-2、Q-3 已回答）

**開工前置條件（主窗口逐項確認，缺一不可）**
- [ ] Q-2：共用 compose 專案名、外部網路名稱、Caddyfile 是否 `import` 子檔與 reload 方式、PostgreSQL 主版號與容器名、apps 目錄慣例（runbook §8-A 盤點輸出）
- [ ] Q-3：子網域，DNS 已指向 VPS
- [ ] 若 PG 主版號 ≠ 16：先改 `docker-compose.dev.yml`、`ci.yml`、`image-smoke.mjs` 的映像版本並重跑全套 Green Gate
- [ ] 使用者已有 VPS SSH 管理權限、可建立 GitHub repo 與 Environment `production`

| 步驟 | 執行者 | 內容 |
|------|--------|------|
| Red | test-creator | `scripts/smoke/deploy-static-check.sh`：`bash -n deploy/deploy.sh`、`shellcheck`（`koalaman/shellcheck:v0.10.0`）、actionlint 檢查 `deploy.yml`、`docker compose -f deploy/compose.yml config`（以範例 env）；`scripts/smoke/remote-healthz.mjs <url>`：`/healthz` 200、`/liff/config.json` 200、`POST /webhook/line` 無簽章 401 |
| Red Gate | 主窗口 | 兩支腳本皆非 0（deploy/** 不存在、網址尚未上線） |
| Green（repo） | nodejs-master | 依 runbook §3、§4、§6.2、§7、§8-B 建 `deploy/compose.yml`、`Caddyfile.snippet`、`deploy.sh`（含 `.last_good_tag` 回滾）、`sql/create-database.sql`、`.github/workflows/deploy.yml`，填入 Q-2/Q-3 實值 |
| Green（VPS） | **使用者**（主窗口提供 runbook §8 B–H 清單逐項勾選） | DB/role、網路、deploy 帳號、forced-command SSH key、DNS/Caddy、GitHub secrets、LINE channel（同一 Provider，R2；redelivery Off，ASM-10） |
| Green Gate | 主窗口 | `deploy-static-check.sh` EXIT 0；push main 後 Actions 綠（`gh run list --limit 1` 貼結果）；`node scripts/smoke/remote-healthz.mjs https://<子網域>` EXIT 0；**人工證據**：真機加好友收到歡迎訊息的截圖 + `docker logs` 中 userId 與 `LINE_OWNER_USER_ID` 相符；回滾演練一次（壞版本 healthz 失敗 → 自動回到 `.last_good_tag`）的 Actions log |

---

### P9：Rich Menu、LIFF 設定、真機驗收

| 步驟 | 執行者 | 內容 |
|------|--------|------|
| Red | test-creator | `tests/unit/cli/setup-rich-menu.test.ts`：以 stub MessagingApiClient 驗證 2×3 版面 6 個 action（ASM-15 第 6 格「紀錄列表」）、同名舊 menu 先刪、建立→上傳圖片→設預設、重跑冪等 |
| Green | nodejs-master | `src/cli/setup-rich-menu.ts`；`deploy/rich-menu/rich-menu.png`（2500×1686）**需使用者提供設計稿**——若使用者同意，可由 master 以腳本產生純文字版（新增 dev 依賴需經同意） |
| Green Gate | 主窗口 | §0.3 全套（GREEN_PATHS=`specs/features`）+ `npm run test:web` + `npm run smoke:image`；VPS 上執行 Rich Menu 腳本的輸出；LIFF app 設定截圖（Endpoint `/liff/`、scope `openid`、Bot link Aggressive） |
| 驗收 | 使用者 | runbook §9 真機清單逐項勾選（三條 activity + 非白名單帳號測試）；主窗口記錄結果 |

---

## 第 6 節：🔵 Refactor 階段

- 每個階段 Green Gate 通過後**直接進入下一階段**；**不自動派任何 reviewer**。
- master 在 Green 輪內可做「同一輪內」的小幅整理（命名、抽函式），但重構後必須重跑 Green Gate 並貼證據。
- 跨階段的重構（例如 P7 後整合 mappers、P8 後抽共用 zod schema）：如需進行，主窗口另開一輪「只重構、測試不變」，Gate 與前一次 Green Gate 相同。

**Optional Manual Quality Pass（使用者決定是否啟用）**

| 對象 | 建議 | 備註 |
|------|------|------|
| `web/**` | `@zenbu-powers:react-reviewer`（opt-in） | 其 checklist 偏 WordPress 前端（AntD/Refine），請在 prompt 明示本專案為 Vite + React 18 純 SPA |
| 後端 `src/**` | 無對應的 Node/Express 專屬 reviewer agent；可用內建 `/code-review` 或 `/security-review`（opt-in） | 安全敏感面：webhook 驗簽（R7）、LIFF ID token 驗證與白名單（R2/R3）、secret redact、deploy forced-command（R19） |
| 安全審查 | **不建議** `@zenbu-powers:security-reviewer` | 該 agent 為 WordPress 專用，不適用本專案 |

---

## 第 7 節：收尾藍圖

0. **Milestone 同步**：`specs/milestones/` 不存在 → 略過。
1. 主窗口跑最終 Green Gate（貼完整證據）：
   ```bash
   cd /d/Dev/line-accounting && export TEST_DATABASE_URL=postgresql://test:test@localhost:5434/test
   npm run typecheck; echo "TYPECHECK_EXIT=$?"
   npm run lint; echo "LINT_EXIT=$?"
   npm run test:unit 2>&1 | tail -25; echo "UNIT_EXIT=${PIPESTATUS[0]}"
   npx cucumber-js --strict 2>&1 | tail -10; echo "BDD_EXIT=${PIPESTATUS[0]}"
   npm run test:web 2>&1 | tail -15; echo "WEB_EXIT=${PIPESTATUS[0]}"
   npm run smoke:image 2>&1 | tail -10; echo "SMOKE_EXIT=${PIPESTATUS[0]}"
   ```
2. spawn `@zenbu-powers:doc-updater`：
   ```
   <§0.5 共用前言，〈收尾〉>
   任務：(1) 首次建立 .claude/CLAUDE.md 與 .claude/rules/*.md（架構分層、檔案所有權、測試指令、Gate 指令、Node 24、DB 啟動方式、
   規格唯讀原則）；(2) 同步 plans/line-accounting/{implementation-plan,deployment-runbook,execution-plan}.md 中殘留的 Node 20 敘述為 Node 24，
   並在 Q-1 標記「已決定：Node 24 LTS」；(3) execution-plan.md 狀態段補上實作完成紀錄。不得修改 specs/**。
   ```
3. 本地模式：保留變更等使用者驗收。commit 建議（**需使用者同意後才執行**，依 git-commit skill 拆分）：每階段 Green Gate 後兩個 commit——`test(<scope>): …`（test-creator 產出）、`feat(<scope>): …`（master 產出）；P2a/P2b 用 `build:`／`ci:`；收尾 `docs:`。commit hash 寫入 `.progress.json`。建議在 §1.4 就請使用者決定「每階段自動 commit」或「全部完成後一次整理」。
4. 主窗口彙整回報：各階段 Gate 證據摘要、BDD example 數與通過數、domain 行覆蓋率（目標 ≥ 90%）、關鍵變更、未完成項（P2b/P9 若仍受 Q-2/Q-3 阻擋）、可選的 opt-in 審查建議（§6）。

---

## 附錄 A：每批預估時間（牆鐘時間，含 agent 執行與主窗口 Gate；不含使用者等待）

| 批次 | Red | Green | Gates | 小計 |
|------|-----|-------|-------|------|
| P0 | 30–45 分（含 npm install、拉 postgres 映像） | 30–45 分 | 10–15 分 | **約 1.5–2 小時** |
| P1 | 20–30 分 | 25–35 分 | 5–10 分 | 約 1 小時 |
| P2a | 15–20 分 | 25–35 分 | 10–15 分（docker build） | 約 1 小時 |
| P3a | 30–40 分 | 40–60 分 | 10 分 | 約 1.5–2 小時 |
| P3b | 20–30 分 | 30–40 分 | 10 分 | 約 1–1.25 小時 |
| P4 | 15–20 分 | 15–25 分 | 5–10 分 | 約 45 分 |
| P5 | 20–30 分 | 25–35 分 | 10 分 | 約 1 小時 |
| P6 | 25–35 分 | 35–45 分 | 10 分 | 約 1.25 小時 |
| P7 | 35–45 分 | 45–60 分 | 15 分 | 約 1.75–2 小時 |
| P8.1 | 35–45 分 | 50–70 分 | 10 分 | 約 1.75–2 小時 |
| P8.2 | 20–30 分 | 35–45 分 | 10 分 | 約 1–1.25 小時 |
| P8.3 | 15 分 | 20–30 分 | 15 分 | 約 1 小時 |
| P2b | 15–20 分 | 30–40 分（repo 端） | 20 分 | 約 1–1.5 小時 + **使用者 VPS/LINE 設定 1–2 小時** |
| P9 | 15 分 | 20–30 分 | 15 分 | 約 1 小時 + **使用者真機驗收 30–60 分** |
| 收尾 | — | doc-updater 20–30 分 | 15 分 | 約 45 分 |
| **合計（序列）** | | | | **約 17–21 小時 agent 時間 + 2–3 小時使用者操作** |

> 若前端 lane（P8.1–P8.2）以 worktree 與後端 P1–P7 平行，可縮短約 3 小時。每次重試（Red 最多 2、Green 最多 3）約再加 15–30 分。
