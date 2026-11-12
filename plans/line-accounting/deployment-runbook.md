# 部署 Runbook：LINE 記帳（Phase 07 Integration / Deploy）

> 搭配 `implementation-plan.md` P2（Walking Skeleton）與 P9（上線收尾）。以下檔案內容為**規格草稿**，實作時由 tdd-coordinator / 實作 agent 依此建立並驗證；`<…>` 為待填值。

---

## 1. 部署拓撲

```
            Internet (HTTPS 443)
                   │
        ┌──────────▼───────────┐   共用 Docker Compose 環境（既有，不由本應用管理）
        │  shared caddy        │──── 其他 app A / app B 的網路
        └──────────┬───────────┘
                   │ network: line-accounting_proxy（bridge，僅 caddy + 本 app）
        ┌──────────▼───────────┐
        │ line-accounting:3000 │  本應用唯一 container（無對外 port，非 root，read-only FS）
        └──────────┬───────────┘
                   │ network: line-accounting_db（--internal，僅 postgres + 本 app）
        ┌──────────▼───────────┐
        │ shared postgres      │  database: line_accounting / role: line_accounting
        └──────────────────────┘

GitHub Actions ──(build/push)──▶ GHCR ghcr.io/<owner>/line-accounting:<sha>
GitHub Actions ──(SSH, forced command)──▶ VPS /opt/apps/line-accounting/deploy.sh
```

隔離原則：本 app 不加入其他 app 的網路；Postgres 與本 app 間用 internal 網路（無對外路由）；app 對外（LINE API）經 `line-accounting_proxy` bridge 出站。

> **Q-2 待確認**：若共用環境目前是「所有 app 共用一個 `proxy` 網路」的慣例，可改為加入該網路（較省事、隔離較弱）。下方以「每 app 專屬網路」為預設。

---

## 2. Dockerfile（repo 根目錄）

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=20          # Q-1：建議 22 或 24（Node 20 已 EOL）
FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci

FROM deps AS build
COPY . .
RUN npx prisma generate \
 && npm run build \
 && npm --prefix web run build

FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate     # prisma CLI 在 dependencies（執行期 migrate 用）

FROM base AS runtime
ENV NODE_ENV=production PORT=3000
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY prisma ./prisma
COPY deploy/compose.yml ./deploy/compose.yml      # deploy.sh 由映像取出，確保 compose 與版本一致
COPY package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
```

`.dockerignore`：`node_modules`、`web/node_modules`、`dist`、`web/dist`、`.env*`（保留 `.env.example`）、`.git`、`reports`、`specs`、`plans`、`tests`。

---

## 3. deploy/compose.yml（本應用 compose 專案）

```yaml
name: line-accounting
services:
  line-accounting:
    image: ghcr.io/<owner>/line-accounting:${IMAGE_TAG:?IMAGE_TAG is required}
    restart: unless-stopped
    env_file: /opt/apps/line-accounting/.env
    networks: [proxy, db]
    read_only: true
    tmpfs: [/tmp]
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    mem_limit: 384m
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }
networks:
  proxy:
    external: true
    name: line-accounting_proxy
  db:
    external: true
    name: line-accounting_db
```

- 無 `ports:`——只由 Caddy 經 Docker 網路存取。
- service 名稱 `line-accounting` 即 Caddy 反代的 DNS 名稱（R17）。
- 若共用環境以 `include:` 統一管理所有 app，也可把此檔 include 進共用 compose；但**預設獨立 compose 專案**，避免 CI 改動共用檔案。

### 共用環境一次性修改（只加網路，不動其他設定）

共用 compose 檔加入：
```yaml
services:
  caddy:
    networks: [<既有網路…>, line-accounting_proxy]
  postgres:
    networks: [<既有網路…>, line-accounting_db]
networks:
  line-accounting_proxy: { external: true }
  line-accounting_db:    { external: true }
```
為避免重建 caddy/postgres 造成其他 app 中斷：先 `docker network connect` 熱接上（立即生效），compose 檔的修改只為了下次重建時保持設定（見 §8-C）。

---

## 4. deploy/Caddyfile.snippet

```caddyfile
<subdomain>.<domain> {
	encode zstd gzip
	# healthz 僅供容器內健康檢查，不對外
	@internal path /healthz
	respond @internal 404
	reverse_proxy line-accounting:3000
	header {
		Strict-Transport-Security "max-age=31536000"
		-Server
	}
}
```

- 放入共用 Caddy 的站台設定（若主 Caddyfile 有 `import sites/*.caddy`，存成 `sites/line-accounting.caddy`；否則附加到主 Caddyfile）。
- App 端 `app.set('trust proxy', 1)`（取得真實 IP 供 log）。
- 不需在 Caddy 做 body 改寫——webhook 簽章依賴原始 body，Caddy `reverse_proxy` 預設原樣轉送。

---

## 5. Secrets 與設定管理

### 5.1 執行期環境變數（只存在 VPS：`/opt/apps/line-accounting/.env`，權限 600，owner deploy）

| Key | 說明 | 來源 |
|-----|------|------|
| `NODE_ENV` | `production` | 固定 |
| `PORT` | `3000` | 固定 |
| `LOG_LEVEL` | `info` | 固定 |
| `APP_BASE_URL` | `https://<subdomain>.<domain>` | DNS |
| `DATABASE_URL` | `postgresql://line_accounting:<urlencoded-pw>@<pg-service-name>:5432/line_accounting?schema=public&connection_limit=5` | §8-B |
| `LINE_CHANNEL_SECRET` | Messaging API channel secret | LINE console |
| `LINE_CHANNEL_ACCESS_TOKEN` | 長期 channel access token | LINE console |
| `LINE_LOGIN_CHANNEL_ID` | LIFF 所屬 LINE Login channel ID（R3） | LINE console |
| `LIFF_ID` | LIFF app ID | LINE console |
| `LINE_OWNER_USER_ID` | 白名單 userId（Messaging API channel「Basic settings → Your user ID」） | LINE console |

- `src/config/env.ts` 以 zod 驗證：全部必填、`LINE_OWNER_USER_ID` 符合 `^U[0-9a-f]{32}$`、`DATABASE_URL` 為 postgres URL；缺漏時 exit 1 並列出 key 名（不印值）。
- **為何不放 GitHub Secrets**：CI 只需要 SSH 權限；執行期 secrets 留在 VPS，GitHub 帳號外洩時不會連帶外洩 LINE token 與 DB 密碼。代價是新增/輪替 secret 需 SSH 上 VPS 修改（單一使用者系統可接受）。
- `connection_limit=5`：共用 Postgres 有三套 app，限制本 app 連線數。
- pino `redact`：`req.headers.authorization`、`req.headers["x-line-signature"]`、`*.token`、`*.accessToken`。

### 5.2 GitHub（Repository → Settings）

| 類型 | Key | 說明 |
|------|-----|------|
| Environment `production` secret | `VPS_HOST` | VPS IP 或主機名 |
| 〃 | `VPS_PORT` | SSH port |
| 〃 | `VPS_USER` | `deploy` |
| 〃 | `VPS_SSH_KEY` | 專用 ed25519 私鑰（僅供部署） |
| 〃 | `VPS_KNOWN_HOSTS` | `ssh-keyscan` 結果（已人工核對指紋） |
| Environment variable | `APP_DOMAIN` | `<subdomain>.<domain>`（部署後公開 smoke 用） |
| 內建 | `GITHUB_TOKEN` | push GHCR（`packages: write`）；傳給 VPS 做一次性 `docker login`（job 結束即失效） |

### 5.3 輪替

- LINE access token / channel secret：LINE console 重新發行 → 改 VPS `.env` → `IMAGE_TAG=$(cat .last_good_tag) docker compose -f … up -d --force-recreate`。
- DB 密碼：`ALTER ROLE line_accounting PASSWORD '…'` → 改 `.env` → recreate。
- 部署金鑰：產新 key → 更新 `authorized_keys` 與 `VPS_SSH_KEY` → 刪舊 key。

---

## 6. GitHub Actions

### 6.1 `.github/workflows/ci.yml`

```yaml
name: CI
on:
  pull_request:
  workflow_call:
permissions: { contents: read }
jobs:
  backend:
    runs-on: ubuntu-24.04
    services:
      postgres:
        image: postgres:16            # 與共用環境主版號一致（Q-2）
        env: { POSTGRES_USER: test, POSTGRES_PASSWORD: test, POSTGRES_DB: test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U test" --health-interval 5s --health-retries 10
    env:
      TEST_DATABASE_URL: postgresql://test:test@localhost:5432/test
    steps:
      - uses: actions/checkout@<pinned-sha>
      - uses: actions/setup-node@<pinned-sha>
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npx prisma generate
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test:unit
      - run: npm run test:bdd -- --strict
      - uses: actions/upload-artifact@<pinned-sha>
        if: always()
        with: { name: cucumber-report, path: reports/ }
  web:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@<pinned-sha>
      - uses: actions/setup-node@<pinned-sha>
        with: { node-version-file: .nvmrc, cache: npm, cache-dependency-path: web/package-lock.json }
      - run: npm --prefix web ci
      - run: npm --prefix web run typecheck
      - run: npm --prefix web test
      - run: npm --prefix web run build
  image-smoke:
    runs-on: ubuntu-24.04
    needs: [backend, web]
    services:
      postgres: { …同上… }
    steps:
      - uses: actions/checkout@<pinned-sha>
      - run: docker build -t la:ci .
      - name: migrate + seed + run + healthz
        run: |
          ENV="-e DATABASE_URL=postgresql://test:test@localhost:5432/test -e LINE_CHANNEL_SECRET=x \
               -e LINE_CHANNEL_ACCESS_TOKEN=x -e LINE_LOGIN_CHANNEL_ID=1 -e LIFF_ID=x \
               -e LINE_OWNER_USER_ID=U00000000000000000000000000000000 -e APP_BASE_URL=http://localhost"
          docker run --rm --network host $ENV la:ci node_modules/.bin/prisma migrate deploy
          docker run --rm --network host $ENV la:ci node dist/cli/seed-defaults.js
          docker run -d --name app --network host $ENV la:ci
          for i in $(seq 1 30); do curl -fsS localhost:3000/healthz && exit 0; sleep 2; done
          docker logs app; exit 1
```

### 6.2 `.github/workflows/deploy.yml`

```yaml
name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      tag: { description: "回滾用：既有映像 tag（commit sha）", required: false }
concurrency: { group: deploy-production, cancel-in-progress: false }
permissions: { contents: read }
jobs:
  ci:
    if: ${{ github.event_name == 'push' }}
    uses: ./.github/workflows/ci.yml
  build:
    if: ${{ github.event_name == 'push' }}
    needs: ci
    runs-on: ubuntu-24.04
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@<pinned-sha>
      - uses: docker/setup-buildx-action@<pinned-sha>
      - uses: docker/login-action@<pinned-sha>
        with: { registry: ghcr.io, username: "${{ github.actor }}", password: "${{ secrets.GITHUB_TOKEN }}" }
      - uses: docker/build-push-action@<pinned-sha>
        with:
          push: true
          tags: ghcr.io/${{ github.repository_owner }}/line-accounting:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
  deploy:
    needs: [build]
    if: ${{ always() && (needs.build.result == 'success' || github.event_name == 'workflow_dispatch') }}
    runs-on: ubuntu-24.04
    environment: production
    permissions: { contents: read, packages: read }
    env:
      TAG: ${{ inputs.tag || github.sha }}
    steps:
      - name: SSH setup
        run: |
          install -m 700 -d ~/.ssh
          echo "${{ secrets.VPS_SSH_KEY }}" > ~/.ssh/id_ed25519 && chmod 600 ~/.ssh/id_ed25519
          echo "${{ secrets.VPS_KNOWN_HOSTS }}" > ~/.ssh/known_hosts
      - name: Deploy
        run: |
          echo "${{ secrets.GITHUB_TOKEN }}" | ssh -p "${{ secrets.VPS_PORT }}" \
            -o StrictHostKeyChecking=yes "${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }}" \
            "deploy $TAG ${{ github.actor }}"
      - name: Public smoke
        run: |
          for i in $(seq 1 10); do
            curl -fsS "https://${{ vars.APP_DOMAIN }}/liff/config.json" && exit 0; sleep 3
          done; exit 1
```

重點：
- 所有第三方 action 釘 commit SHA（實作時用 `zenbu-powers:github-actions` skill 確認版本）。
- push main 才建置/部署；PR 只跑 CI。`concurrency` 確保部署序列化。
- `workflow_dispatch` + `tag` = 一鍵回滾（不重新 build，**不回滾 migration**，見 §10）。
- 建議在 GitHub 設定 `main` 分支保護：需 PR + CI 綠燈（單人專案可選擇允許直接 push，但 deploy 仍先跑 CI）。
- 實作後以 `actionlint` 檢查 workflow。

---

## 7. deploy/deploy.sh（VPS：`/opt/apps/line-accounting/deploy.sh`，owner deploy，755）

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR=/opt/apps/line-accounting
IMAGE=ghcr.io/<owner>/line-accounting
COMPOSE="docker compose -p line-accounting -f $APP_DIR/compose.yml"

read -r CMD TAG ACTOR _ <<< "${SSH_ORIGINAL_COMMAND:-}"
[[ "$CMD" == "deploy" ]] || { echo "forbidden"; exit 2; }
[[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]] || { echo "bad tag"; exit 2; }
[[ "$ACTOR" =~ ^[A-Za-z0-9-]{1,39}$ ]] || { echo "bad actor"; exit 2; }

exec 9>"$APP_DIR/.deploy.lock"; flock -n 9 || { echo "deploy in progress"; exit 75; }
log(){ echo "[$(date -Is)] $*" | tee -a "$APP_DIR/deploy.log"; }

docker login ghcr.io -u "$ACTOR" --password-stdin >/dev/null   # token 由 stdin 傳入
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

log "pull $TAG"
docker pull "$IMAGE:$TAG"
# 從映像取出與此版本一致的 compose.yml
cid=$(docker create "$IMAGE:$TAG"); docker cp "$cid:/app/deploy/compose.yml" "$APP_DIR/compose.yml"; docker rm "$cid" >/dev/null
export IMAGE_TAG="$TAG"

log "migrate"
$COMPOSE run --rm --no-deps line-accounting node_modules/.bin/prisma migrate deploy
log "seed defaults"
$COMPOSE run --rm --no-deps line-accounting node dist/cli/seed-defaults.js

log "up"
$COMPOSE up -d --no-deps --remove-orphans line-accounting
for i in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$($COMPOSE ps -q line-accounting)" 2>/dev/null || echo starting)
  if [[ "$status" == "healthy" ]]; then
    echo "$TAG" > "$APP_DIR/.last_good_tag"; log "healthy $TAG"
    # 只清理「本應用」的舊映像，保留最新 5 個；共用 VPS 上絕不可用 `docker image prune -a`（會刪到其他 app 的映像）
    docker images "$IMAGE" --format '{{.Tag}}' | tail -n +6 | xargs -r -I{} docker rmi "$IMAGE:{}" >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 3
done

log "UNHEALTHY $TAG → rollback"
$COMPOSE logs --tail 100 line-accounting || true
if [[ -f "$APP_DIR/.last_good_tag" ]]; then
  IMAGE_TAG=$(cat "$APP_DIR/.last_good_tag") $COMPOSE up -d --no-deps line-accounting
fi
exit 1
```

注意：
- 儲存庫中的 `deploy/deploy.sh` 為版本控制來源；VPS 上的副本**手動更新**（forced command 不允許 scp，屬刻意設計）。改動時 runbook 記錄。
- 映像清理只針對 `ghcr.io/<owner>/line-accounting`，保留最新 5 個 tag 以利回滾。
- 第一次部署前 `.last_good_tag` 不存在 → 失敗時不回滾（服務本來就不存在）。

---

## 8. VPS 一次性設定清單

### A. 現況盤點（Q-2，P2 開工前）

- [ ] `docker compose ls`、`docker network ls`：確認共用 compose 專案名稱、caddy/postgres 的 container 與 service 名稱、既有網路慣例
- [ ] `docker exec <postgres> psql -V`：PostgreSQL 版本（CI/dev 映像對齊此主版號）
- [ ] 找到 Caddyfile 位置與是否使用 `import`；確認 caddy reload 方式
- [ ] `free -h`、`df -h`：確認記憶體（建議剩餘 ≥ 512MB）與磁碟（映像約 250–350MB × 保留數）
- [ ] 確認共用備份範圍會涵蓋新 database `line_accounting`（若備份腳本以 database 清單運作，需加入）

### B. 資料庫（`deploy/sql/create-database.sql`）

```sql
-- 以共用 postgres superuser 執行
CREATE ROLE line_accounting LOGIN PASSWORD '<strong-random>';
CREATE DATABASE line_accounting OWNER line_accounting ENCODING 'UTF8' TEMPLATE template0;
REVOKE CONNECT ON DATABASE line_accounting FROM PUBLIC;
GRANT CONNECT ON DATABASE line_accounting TO line_accounting;
-- 確認其他 app 的 role 不能連進本 DB；本 role 也不應有其他 DB 的 CONNECT
```
- [ ] 密碼：`openssl rand -base64 36 | tr -d '/+=' | cut -c1-40`（避開需 URL 編碼的字元）
- [ ] 若 `pg_hba.conf` 有依網段限制，加入 `line-accounting_db` 網段（scram-sha-256）
- [ ] 驗證：`docker run --rm --network line-accounting_db postgres:16 psql "<DATABASE_URL>" -c 'select 1'`

### C. 網路

- [ ] `docker network create line-accounting_proxy`
- [ ] `docker network create --internal line-accounting_db`
- [ ] `docker network connect line-accounting_proxy <caddy-container>`（熱接，不重啟）
- [ ] `docker network connect line-accounting_db <postgres-container>`
- [ ] 修改共用 compose 檔（§3）使重建後仍保留；**先** `docker compose config` 驗證語法，不立即 `up`

### D. 部署帳號與目錄

- [ ] `sudo adduser --disabled-password --gecos "" deploy && sudo usermod -aG docker deploy`（R19：docker 群組 = root 等級，故下一步以 forced command 限縮）
- [ ] `sudo install -d -o deploy -g deploy -m 700 /opt/apps/line-accounting`
- [ ] 放置 `/opt/apps/line-accounting/deploy.sh`（755）與 `.env`（600，內容見 §5.1）

### E. SSH 部署金鑰（在 Windows 開發機 PowerShell）

- [ ] `ssh-keygen -t ed25519 -C "gha-deploy-line-accounting" -f $HOME\.ssh\la_deploy -N '""'`
- [ ] VPS `~deploy/.ssh/authorized_keys`：
  `command="/opt/apps/line-accounting/deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA… gha-deploy-line-accounting`
- [ ] `ssh-keyscan -p <port> <host>`，與 VPS 上 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` 指紋核對後存為 `VPS_KNOWN_HOSTS`
- [ ] 私鑰內容存入 GitHub `VPS_SSH_KEY` 後，自開發機刪除或妥善保管

### F. DNS 與 Caddy

- [ ] DNS A/AAAA：`<subdomain>.<domain>` → VPS IP（Q-3）
- [ ] 加入 Caddyfile 片段（§4）→ `docker exec <caddy> caddy validate --config /etc/caddy/Caddyfile` → `docker exec <caddy> caddy reload --config /etc/caddy/Caddyfile`
- [ ] 首次部署後確認憑證自動簽發：`curl -I https://<subdomain>.<domain>/liff/config.json`

### G. GitHub

- [ ] 建立 repo、push main（首次 push 會觸發部署：建議先設好 B–F 再 push，或先 push 到分支）
- [ ] 建 Environment `production`，填入 §5.2 secrets/variables
- [ ] 首次推送 GHCR 後，確認 package 為 private 且 repo 有存取權
- [ ] 分支保護（可選）

### H. LINE 平台（同一 Provider！R2）

- [ ] 建立 Provider
- [ ] Messaging API channel：取得 channel secret、發行長期 access token；Basic settings 抄下「Your user ID」→ `LINE_OWNER_USER_ID`
- [ ] Messaging API 設定：Webhook URL `https://<subdomain>.<domain>/webhook/line`、Use webhook = On、**Webhook redelivery = Off**（ASM-10）、Auto-reply messages = Off、Greeting messages = Off → 按 Verify 應成功
- [ ] LINE Login channel（**同 Provider**）→ 建 LIFF app：Size Full、Endpoint `https://<subdomain>.<domain>/liff/`、Scope `openid`、Bot link feature On (Aggressive) → 取得 `LIFF_ID`；channel ID → `LINE_LOGIN_CHANNEL_ID`；channel 狀態設為 Published
- [ ] 部署後執行 Rich Menu：`IMAGE_TAG=$(cat .last_good_tag) docker compose -p line-accounting -f /opt/apps/line-accounting/compose.yml run --rm line-accounting node dist/cli/setup-rich-menu.js`（需 SSH 管理帳號，非 deploy forced command）

### I. 本機開發（Windows 11）

- [ ] Docker Desktop（WSL2 backend）；`docker compose -f docker-compose.dev.yml up -d`
- [ ] 另建「開發用」Messaging API + LINE Login channel（同一 dev provider），webhook 經 `cloudflared tunnel --url http://localhost:3000` 暴露；正式 channel 永不指向開發機（ASM-13）
- [ ] `git config core.autocrlf false`（搭配 `.gitattributes`）

---

## 9. 上線驗收清單（真機）

**LINE 快速記帳**
- [ ] 非白名單帳號加好友 → 「此服務不開放使用」；傳「餐飲 120」→ 同樣回覆；DB 無新增
- [ ] 擁有者加好友 → 歡迎訊息；`categories` 19 筆（若部署時已 seed，數量不變）
- [ ] 「餐飲 120」→ 已記帳摘要 + 刪除鈕；點刪除 → 確認 → 確定 → 已刪除；再點一次舊刪除鈕 → 此紀錄已不存在
- [ ] 「早餐 80 便利商店」→ 分類 Quick Reply → 選餐飲 → 已記帳；再次「早餐 60」→ 直接歸餐飲
- [ ] 快速連點同一分類按鈕兩次 → 第二次「此筆已記帳」
- [ ] 「公 +營業收入 30000 A客戶」→ 公司收入
- [ ] 「餐飲 12.5」→ 金額必須為正整數；「你好」→ 格式說明

**統計查詢**
- [ ] Rich Menu「本月摘要」→ 摘要 + 查看圖表按鈕 → 開啟 LIFF 圖表頁且月份/帳本正確
- [ ] 打「公 上月」→ 公司上月摘要

**LIFF 帳目維護**
- [ ] 列表切換月份/帳本；編輯一筆改帳本 → 分類選單清空重選 → 儲存成功
- [ ] 表單新增過去日期紀錄；列表刪除
- [ ] 分類管理新增「寵物」→ 重複新增顯示名稱重複；刪除有紀錄的分類 → 紀錄改歸「其他」
- [ ] 以非白名單帳號開 LIFF 連結 → 顯示無權限
- [ ] LIFF 開著超過 1 小時後操作 → 自動重新登入後成功（R10）

**運維**
- [ ] `docker ps`：本 app 無對外 port；`docker inspect` 網路僅 `line-accounting_proxy`、`line-accounting_db`
- [ ] `docker logs` 無 token/secret 明文
- [ ] 以 `workflow_dispatch` 回滾到前一 tag 演練一次

---

## 10. 運維與回滾

- **Log**：`docker compose -p line-accounting -f /opt/apps/line-accounting/compose.yml logs -f --tail 200`；部署紀錄 `/opt/apps/line-accounting/deploy.log`。
- **回滾程式**：GitHub Actions → Deploy → Run workflow → `tag=<舊 sha>`。
- **Migration 原則（R18）**：只做向後相容變更（新增欄位可為 null/有預設、先加新欄位→程式雙寫→再移除舊欄位，分兩次部署）。回滾程式不回滾 schema。
- **資料性 migration 前手動備份**（共用備份之外的保險）：
  `docker exec <postgres> pg_dump -U line_accounting -Fc line_accounting > /opt/apps/line-accounting/backup-$(date +%F).dump`（用後刪除或移至共用備份位置）。
- **健康檢查**：容器內 `/healthz`（`SELECT 1`）；外部只以 `/liff/config.json` 做 smoke。
