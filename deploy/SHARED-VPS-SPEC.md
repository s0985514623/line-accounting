# 共用 VPS × GitHub Actions × LINE 部署規格（多應用範本）

> 來源：`line-accounting` 已上線的部署設計（commit `cfbac38`，2026-11-13 首次部署成功）。
> 用途：讓同一台 VPS 上的其他應用（`calendar`、`site-manager`）照同一套規格接上 GitHub Actions 部署。
> 範本中 `<app>` 一律換成應用代號（小寫、無空白，例：`calendar`）。

---

## 0. 速查：哪些共用、哪些每個 app 各一份

| 項目 | 共用（三個 app 相同） | 每個 app 各自一份 |
| --- | --- | --- |
| VPS 主機 | IPv4 `139.162.95.207`、SSH port `22`、帳號 `deploy` | — |
| 目錄 | `/opt/my-services/{infra,apps,secrets}` | `/opt/my-services/apps/<app>/` |
| 反向代理 | Caddy 2.10（`infra-caddy-1`） | 網域、Caddyfile 站台區塊、網路 `proxy_<app>` |
| 資料庫 | PostgreSQL 17（`infra-postgres-1`，service 名 `postgres`） | database `<app>`、role `<app>`、網路 `db_<app>` |
| 映像倉庫 | GHCR，owner `s0985514623` | `ghcr.io/s0985514623/<repo>` |
| SSH | `VPS_KNOWN_HOSTS`（同一台主機，內容相同） | **部署金鑰**（forced command 綁定單一 app 的 `deploy.sh`） |
| GitHub Secrets | `VPS_HOST` / `VPS_PORT` / `VPS_USER` / `VPS_KNOWN_HOSTS` 值相同，但每個 repo 都要設 | `VPS_SSH_KEY`、Variable `APP_DOMAIN` |
| LINE | Provider 可共用 | Messaging API channel、LINE Login channel / LIFF |

個人帳號沒有跨 repo 的 Secrets，共用值也要在每個 repo 的 Environment `production` 各設一次。

---

## 1. 應用（映像）必須符合的規格

`deploy.sh` 靠容器 HEALTHCHECK 判斷成功或回滾，所以映像必須：

1. 監聽 `PORT`（預設 `3000`），Caddy 以 `<app>-app:3000` 轉發。
2. 提供 `GET /healthz` → 200（DB 連線失敗時回非 2xx）。
3. Dockerfile 內有 `HEALTHCHECK`（`deploy.sh` 等它變 `healthy`，上限約 90 秒）：
   ```dockerfile
   HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
     CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
   ```
4. 以非 root 執行（`USER node`）。
5. 映像內不放 `.env` 與 `docker-compose.yml`；執行期設定全部從 VPS 的 `.env` 讀。
6. migration / seed 等部署前指令可用同一映像執行（例：`node_modules/.bin/prisma migrate deploy`）。
7. migration 必須向後相容（先 expand、下一版再 contract），因為回滾只換映像、不回滾 DB。
8. `DATABASE_URL` 加上 `connection_limit=5`（三個 app 共用一個 PostgreSQL）。

---

## 2. VPS 端規格（每個 app 一次性設定）

### 2.1 目錄與檔案

```
/opt/my-services/apps/<app>/
├── docker-compose.yml   # 使用者管理，不進 repo
├── .env                 # deploy:deploy 600，執行期 secrets
├── deploy.sh            # deploy:deploy 755，從 repo 的 deploy/deploy.sh 安裝
├── .last_good_tag       # deploy.sh 產生（回滾依據）
├── .deploy.lock         # deploy.sh 產生（flock）
└── deploy.log           # deploy.sh 產生
```

```bash
$ sudo install -d -o deploy -g deploy -m 750 /opt/my-services/apps/<app>
$ sudo chown deploy:deploy /opt/my-services/apps/<app>/.env && sudo chmod 600 /opt/my-services/apps/<app>/.env
```

> 已踩過的坑：accounting 的 `.env` 原本是 `root:root 600`，`deploy` 讀不到，compose 會失敗。

### 2.2 `docker-compose.yml`（app slot）

對照 accounting 的現有檔案複製改名。關鍵規格：

| 欄位 | 值 |
| --- | --- |
| compose project | `<app>`（`docker compose -p <app>`） |
| service 名 | `app` |
| image | `${APP_IMAGE:-traefik/whoami:v1.10}`（由 `deploy.sh` 以環境變數注入版本） |
| env_file | `.env` |
| networks | `proxy_<app>`（alias `<app>-app`）+ `db_<app>`（internal） |
| 記憶體上限 | accounting 為 `768m`；三個 app 合計不可超過 VPS RAM 扣掉 Caddy/Postgres |

```yaml
# 範本：網路宣告方式（external 與否）請與 accounting 的實際檔案一致
services:
  app:
    image: ${APP_IMAGE:-traefik/whoami:v1.10}
    restart: unless-stopped
    env_file: .env
    mem_limit: 768m
    networks:
      proxy_<app>:
        aliases: [<app>-app]
      db_<app>: {}
networks:
  proxy_<app>:
    external: true
  db_<app>:
    external: true
```

### 2.3 共用 infra 要補的設定（`/opt/my-services/infra`）

1. 網路：建立 `proxy_<app>`、`db_<app>`（`db_<app>` 為 internal），讓 Caddy 加入 `proxy_<app>`、Postgres 加入 `db_<app>`。
2. Caddy：`infra/.env` 加 `<APP>_DOMAIN=<app>.ren-codes.com`，Caddyfile 照 accounting 區塊新增
   `{$<APP>_DOMAIN}` → `reverse_proxy <app>-app:3000`，然後 reload Caddy。
3. PostgreSQL：
   ```bash
   $ docker exec -it infra-postgres-1 psql -U <superuser>
   ```
   ```sql
   CREATE ROLE <app> LOGIN PASSWORD '<password>';
   CREATE DATABASE <app> OWNER <app>;
   REVOKE ALL ON DATABASE <app> FROM PUBLIC;
   ```
   密碼存到 `/opt/my-services/secrets/<app>_db_password`。
4. DNS：`<app>.ren-codes.com` 的 A 指向 `139.162.95.207`（有 AAAA 也可以，但 GitHub runner 只走 IPv4）。

### 2.4 防火牆（三個 app 共用，只需做一次，accounting 已完成）

- `ufw`：`22/tcp` 必須允許 Anywhere（GitHub runner IP 不固定）。
- Linode Cloud Firewall：同樣放行 22/tcp。
- 安全性靠 forced command + `restrict`，不靠來源 IP。

### 2.5 部署金鑰（每個 app 一把，不可共用）

一把 key 在 `authorized_keys` 只能綁一個 `command=`，所以每個 app 都要自己的金鑰：

```powershell
PS> ssh-keygen -t ed25519 -C "gha-deploy-<app>" -N '' -f "$HOME\.ssh\<app>_deploy"
```

`/home/deploy/.ssh/authorized_keys` 追加一行：

```text
command="/opt/my-services/apps/<app>/deploy.sh",restrict ssh-ed25519 AAAA...（<app>_deploy.pub 第二欄） gha-deploy-<app>
```

驗證（應回 `forbidden`，exit 2）：

```powershell
PS> ssh -i "$HOME\.ssh\<app>_deploy" -p 22 deploy@139.162.95.207 "ls"
```

### 2.6 `deploy.sh` 安裝（forced command 不允許 scp，用管理員帳號）

```powershell
PS> scp -P 22 .\deploy\deploy.sh <admin>@139.162.95.207:/tmp/deploy.sh
```
```bash
$ sudo install -o deploy -g deploy -m 755 /tmp/deploy.sh /opt/my-services/apps/<app>/deploy.sh && rm /tmp/deploy.sh
$ head -1 /opt/my-services/apps/<app>/deploy.sh | od -c | head -2   # 不可有 \r
```

repo 加 `.gitattributes`：`deploy/*.sh text eol=lf`，避免 Windows 存成 CRLF。

---

## 3. GitHub 規格（每個 repo）

### 3.1 Environment `production`（Deployment branches 限 `main`）

| 類型 | 名稱 | 值 | 三個 app 是否相同 |
| --- | --- | --- | --- |
| Secret | `VPS_HOST` | `139.162.95.207` | 相同 |
| Secret | `VPS_PORT` | `22` | 相同 |
| Secret | `VPS_USER` | `deploy` | 相同 |
| Secret | `VPS_KNOWN_HOSTS` | `ssh-keyscan -p 22 -t ed25519 139.162.95.207` 的輸出（人工比對指紋） | 相同（可直接沿用 accounting 的值） |
| Secret | `VPS_SSH_KEY` | `<app>_deploy` **私鑰**完整內容 | **不同** |
| Variable | `APP_DOMAIN` | `<app>.ren-codes.com`（不含 `https://`） | **不同** |

### 3.2 其他

- GHCR：首次 push 後會建立 private package；確認 Package settings → Manage Actions access 中該 repo 有 **Read**。
- `main` 分支保護：需 PR + CI 綠燈。
- 第三方 action 一律釘 commit SHA（沿用下方範本的 SHA）。

### 3.3 部署流程（三個 app 相同）

```
push main ─▶ CI（workflow_call）─▶ build & push ghcr.io/s0985514623/<repo>:<sha>
          ─▶ deploy（Environment production）
               echo $GITHUB_TOKEN | ssh deploy@VPS "deploy <sha> <actor>"
                 └─ VPS forced command：deploy.sh
                      flock → docker login(stdin) → pull → 部署前指令(migrate/seed)
                      → up -d app → 等 healthy（約 90 秒）
                      → 成功：寫 .last_good_tag、只清本 app 舊映像（保留 5 個）
                      → 失敗：印 logs，回滾到 .last_good_tag，exit 1
          ─▶ public smoke：https://$APP_DOMAIN/healthz
workflow_dispatch(tag=<sha>) ─▶ 不建置，直接部署既有映像 = 一鍵回滾
```

---

## 4. LINE 規格（有用到 LINE 的 app 才需要）

| 項目 | 規格 |
| --- | --- |
| Provider | 三個 app 放**同一個 Provider**，同一位使用者的 `userId` 才會一致（userId 以 Provider 為範圍） |
| Messaging API channel | **每個 app 各一個**（一個 channel 只能設一個 Webhook URL） |
| Webhook URL | `https://<app>.ren-codes.com/webhook/line`，Use webhook **On**，Redelivery **Off** |
| 自動回應 | LINE Official Account Manager 關閉「自動回應訊息」 |
| LINE Login channel | 與 Messaging API channel 同 Provider；LIFF 掛在這裡 |
| LIFF | Endpoint `https://<app>.ren-codes.com/liff/`，Scope 含 `openid` |
| Webhook Verify | 首次部署成功後才按 |

對應 `.env` key（沿用 accounting 命名，方便共用程式碼）：

```dotenv
LINE_CHANNEL_SECRET=          # Messaging API → Basic settings → Channel secret
LINE_CHANNEL_ACCESS_TOKEN=    # Messaging API → long-lived token
LINE_OWNER_USER_ID=           # Basic settings 最下方 Your user ID（U + 32 碼）
LINE_LOGIN_CHANNEL_ID=        # LINE Login channel 的 Channel ID（不是 Messaging API 的）
LIFF_ID=                      # LIFF app ID
```

---

## 5. `.env` 範本（VPS：`/opt/my-services/apps/<app>/.env`）

```dotenv
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
APP_BASE_URL=https://<app>.ren-codes.com
DATABASE_URL=postgresql://<app>:<url-encoded-pw>@postgres:5432/<app>?schema=public&connection_limit=5
# LINE（若有）見第 4 節
```

---

## 6. 範本檔案（複製到其他 repo 後改最上方變數）

### 6.1 `.github/workflows/deploy.yml`

需改：`env.IMAGE`、`concurrency.group`。CI job 若該 repo 沒有可 `workflow_call` 的 `ci.yml`，先刪掉 `ci` job 並把 `build.needs` 移除。

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      tag:
        description: 回滾用：既有映像 tag（完整 40 碼 commit sha）
        required: true
        type: string

concurrency:
  group: deploy-production-<app>
  cancel-in-progress: false

permissions:
  contents: read

env:
  IMAGE: ghcr.io/s0985514623/<repo>

jobs:
  ci:
    name: CI
    if: ${{ github.event_name == 'push' }}
    uses: ./.github/workflows/ci.yml

  build:
    name: build & push GHCR
    if: ${{ github.event_name == 'push' }}
    needs: ci
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1
      - uses: docker/login-action@81c6f93d4bc991e510b342a00b419b3bb4efc5c6 # v4.7.0
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
        with:
          context: .
          push: true
          tags: ${{ env.IMAGE }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    name: deploy（VPS）+ public smoke
    needs: build
    if: >-
      ${{ !cancelled() && (needs.build.result == 'success' ||
      (github.event_name == 'workflow_dispatch' && needs.build.result == 'skipped')) }}
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    environment:
      name: production
      url: https://${{ vars.APP_DOMAIN }}
    permissions:
      contents: read
      packages: read
    env:
      TAG: ${{ inputs.tag || github.sha }}
      APP_DOMAIN: ${{ vars.APP_DOMAIN }}
    steps:
      - name: 驗證參數
        run: |
          [[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]] || { echo "::error::bad tag: $TAG"; exit 1; }
          [[ -n "$APP_DOMAIN" ]] || { echo "::error::APP_DOMAIN 未設定"; exit 1; }

      - name: SSH 設定
        env:
          VPS_SSH_KEY: ${{ secrets.VPS_SSH_KEY }}
          VPS_KNOWN_HOSTS: ${{ secrets.VPS_KNOWN_HOSTS }}
        run: |
          install -m 700 -d ~/.ssh
          printf '%s\n' "$VPS_SSH_KEY" > ~/.ssh/id_ed25519 && chmod 600 ~/.ssh/id_ed25519
          printf '%s\n' "$VPS_KNOWN_HOSTS" > ~/.ssh/known_hosts && chmod 644 ~/.ssh/known_hosts

      - name: 部署 ${{ env.TAG }}
        env:
          VPS_HOST: ${{ secrets.VPS_HOST }}
          VPS_PORT: ${{ secrets.VPS_PORT }}
          VPS_USER: ${{ secrets.VPS_USER }}
          GHCR_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ACTOR: ${{ github.actor }}
        run: |
          printf '%s\n' "$GHCR_TOKEN" | ssh -p "$VPS_PORT" -i ~/.ssh/id_ed25519 \
            -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
            -o UserKnownHostsFile="$HOME/.ssh/known_hosts" \
            -o ConnectTimeout=20 -o ServerAliveInterval=15 \
            "$VPS_USER@$VPS_HOST" "deploy $TAG $ACTOR"

      - name: 清除 SSH 金鑰
        if: always()
        run: rm -f ~/.ssh/id_ed25519

      - name: Public smoke
        run: |
          curl -fsS --retry 10 --retry-delay 5 --retry-all-errors --max-time 10 \
            "https://$APP_DOMAIN/healthz"
```

### 6.2 `deploy/deploy.sh`

需改：最上方 4 個變數 + `pre_deploy()` 內容。其餘與 accounting 版相同。

```bash
#!/usr/bin/env bash
# VPS 部署腳本：SSH forced command，只接受 `deploy <sha> <actor>`，GHCR token 由 stdin 傳入
set -Eeuo pipefail

# ---- 每個 app 修改這裡 -------------------------------------------------------------
APP=<app>                                   # compose project 名稱 = 目錄名
IMAGE=ghcr.io/s0985514623/<repo>
SERVICE=app
KEEP_IMAGES=5
# ------------------------------------------------------------------------------------

APP_DIR=/opt/my-services/apps/$APP
COMPOSE_FILE="$APP_DIR/docker-compose.yml"
HEALTH_TRIES=30   # × 3 秒 ≈ 90 秒
HEALTH_INTERVAL=3
COMPOSE=(docker compose -p "$APP" -f "$COMPOSE_FILE")

# 部署前指令（在新映像中執行，失敗則不更動服務）。沒有就留空函式。
pre_deploy() {
  "${COMPOSE[@]}" run --rm -T --no-deps "$SERVICE" node_modules/.bin/prisma migrate deploy < /dev/null
  # "${COMPOSE[@]}" run --rm -T --no-deps "$SERVICE" node dist/cli/seed.js < /dev/null
}

CMD="" TAG="" ACTOR=""
read -r CMD TAG ACTOR _ <<< "${SSH_ORIGINAL_COMMAND:-}" || true
[[ "$CMD" == "deploy" ]] || { echo "forbidden" >&2; exit 2; }
[[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]] || { echo "bad tag" >&2; exit 2; }
[[ "$ACTOR" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$ ]] || { echo "bad actor" >&2; exit 2; }
[[ -f "$COMPOSE_FILE" ]] || { echo "missing $COMPOSE_FILE" >&2; exit 2; }

exec 9>"$APP_DIR/.deploy.lock"
flock -n 9 || { echo "deploy in progress" >&2; exit 75; }

log() { echo "[$(date -Is)] $*" | tee -a "$APP_DIR/deploy.log"; }

wait_healthy() {
  local cid status i
  for ((i = 1; i <= HEALTH_TRIES; i++)); do
    cid="$("${COMPOSE[@]}" ps -q "$SERVICE" 2>/dev/null || true)"
    if [[ -n "$cid" ]]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
      case "$status" in
        healthy) return 0 ;;
        unhealthy | exited | dead) log "container status=$status"; return 1 ;;
      esac
    fi
    sleep "$HEALTH_INTERVAL"
  done
  log "health check timeout"; return 1
}

# 共用 VPS：只清本 app 的映像，絕不可用 `docker image prune -a`
prune_images() {
  local old
  docker images "$IMAGE" --format '{{.Tag}}' \
    | grep -vx -e "$TAG" -e '<none>' \
    | tail -n +"$KEEP_IMAGES" \
    | while read -r old; do docker rmi "$IMAGE:$old" >/dev/null 2>&1 || true; done
}

docker login ghcr.io -u "$ACTOR" --password-stdin >/dev/null
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

log "deploy $TAG by $ACTOR"
docker pull --quiet "$IMAGE:$TAG"
export APP_IMAGE="$IMAGE:$TAG"

log "pre-deploy"
if ! pre_deploy; then log "FAILED pre-deploy $TAG（服務未變更）"; exit 1; fi

log "up"
if "${COMPOSE[@]}" up -d --no-deps "$SERVICE" && wait_healthy; then
  echo "$TAG" > "$APP_DIR/.last_good_tag"
  log "healthy $TAG"
  prune_images || true
  exit 0
fi

log "UNHEALTHY $TAG"
"${COMPOSE[@]}" logs --no-color --tail 100 "$SERVICE" || true
if [[ -f "$APP_DIR/.last_good_tag" ]]; then
  PREV="$(< "$APP_DIR/.last_good_tag")"
  if [[ "$PREV" =~ ^[0-9a-f]{7,40}$ ]]; then
    log "rollback → $PREV"
    export APP_IMAGE="$IMAGE:$PREV"
    "${COMPOSE[@]}" up -d --no-deps "$SERVICE" || true
    if wait_healthy; then log "rollback healthy $PREV"; else log "rollback UNHEALTHY $PREV（需人工處理）"; fi
  fi
else
  log "無 .last_good_tag（首次部署），不回滾"
fi
exit 1
```

---

## 7. 新 app 上線檢查清單（照順序）

1. [ ] 映像符合第 1 節（`/healthz`、HEALTHCHECK、`USER node`、PORT 3000）
2. [ ] VPS：目錄、compose、`.env`（deploy:deploy 600）、DB/role、網路、Caddy、DNS（第 2.1–2.3 節）
3. [ ] 部署金鑰 + `authorized_keys` forced command，驗證回 `forbidden`（第 2.5 節）
4. [ ] `deploy.sh` 安裝到 VPS，確認無 CRLF（第 2.6 節）
5. [ ] GitHub Environment `production`：5 個 Secrets + `APP_DOMAIN`（第 3.1 節）
6. [ ] 放入 `deploy.yml`，push `main`，Actions 全綠
7. [ ] （LINE app）設定 Webhook URL → Verify、LIFF Endpoint（第 4 節）
8. [ ] VPS 確認：`cat .last_good_tag`、`tail deploy.log`、`docker compose -p <app> ps`

## 8. 疑難排解（三個 app 通用）

| 現象 | 原因 / 處理 |
| --- | --- |
| `forbidden` / `bad tag` / `bad actor` | SSH 指令格式錯，或 actor 為 `xxx[bot]` |
| exit 75 `deploy in progress` | 同 app 另一個部署持有 `.deploy.lock` |
| pull `denied` / `unauthorized` | GHCR package 未給該 repo Read 權限 |
| `Host key verification failed` | `VPS_KNOWN_HOSTS` 與 `VPS_HOST`/`VPS_PORT` 不一致 |
| SSH timeout | ufw / Linode Cloud Firewall 未放行 22 Anywhere |
| compose 讀不到 `.env` | `.env` owner 不是 `deploy` |
| 502（Caddy） | Caddy 未加入 `proxy_<app>` 網路，或 alias 不是 `<app>-app` |
