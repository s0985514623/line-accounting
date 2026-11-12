# 部署（P2b）：VPS 一次性設定與操作

本目錄只有兩個檔案：

| 檔案        | 用途                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `deploy.sh` | VPS 上的 SSH forced command（`/opt/my-services/apps/accounting/deploy.sh`）。repo 內為版本控制來源。 |
| `README.md` | 本說明                                                                                               |

VPS 的 `docker-compose.yml`、Caddy 站台、資料庫 `accounting` / role `accounting`、網路 `proxy_accounting` / `db_accounting`
皆由使用者在 VPS 上管理，**不在 repo 內**，`deploy.sh` 也不會覆寫。

## 部署流程概觀

```
push main ─▶ CI（ci.yml，workflow_call）─▶ build & push ghcr.io/s0985514623/line-accounting:<sha>
          ─▶ deploy job（Environment production）
               echo $GITHUB_TOKEN | ssh deploy@VPS "deploy <sha> <actor>"
                 └─ VPS forced command：deploy.sh
                      docker login（stdin token）→ pull → prisma migrate deploy → seed 預設分類
                      → up -d app → 等 HEALTHCHECK healthy（約 90 秒）
                      → 成功：寫 .last_good_tag、只清本應用舊映像（保留 5 個）
                      → 失敗：印 logs，回滾到 .last_good_tag（不存在則不回滾），exit 1
          ─▶ public smoke：node scripts/smoke/remote-healthz.mjs https://$APP_DOMAIN --retries 10
```

映像版本以環境變數 `APP_IMAGE=ghcr.io/s0985514623/line-accounting:<sha>` 傳給
`docker compose -p accounting -f /opt/my-services/apps/accounting/docker-compose.yml`
（shell 環境變數優先於 `.env` 插值；compose 檔中 `image: ${APP_IMAGE:-traefik/whoami:v1.10}`）。

---

## 一次性設定（依序執行）

以下 `<VPS_HOST>`、`<SSH_PORT>` 請換成實值；`$` 開頭為 VPS（bash，管理員帳號），`PS>` 開頭為 Windows 開發機 PowerShell。

### 1. 確認 deploy 帳號與目錄

```bash
$ id deploy                                   # 輸出須含 docker 群組
$ sudo usermod -aG docker deploy              # 若沒有 docker 群組才執行
$ sudo -u deploy docker compose version       # deploy 可直接使用 docker compose v2
$ command -v flock                            # util-linux，deploy.sh 需要
$ ls -ld /opt/my-services/apps/accounting     # owner 須為 deploy
```

### 2. 放置 `.env`（執行期 secrets 只存在 VPS）

以 repo 的 `.env.example` 為範本，至少：

```dotenv
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
APP_BASE_URL=https://accounting.ren-codes.com
DATABASE_URL=postgresql://accounting:<url-encoded-pw>@postgres:5432/accounting?schema=public&connection_limit=5
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_OWNER_USER_ID=U...
LINE_LOGIN_CHANNEL_ID=...
LIFF_ID=...
```

```bash
$ sudo chown deploy:deploy /opt/my-services/apps/accounting/.env
$ sudo chmod 600 /opt/my-services/apps/accounting/.env
```

### 3. 放置 `deploy.sh`

forced command 不允許 scp，因此以管理員帳號上傳後安裝：

```bash
PS> scp -P <SSH_PORT> D:\Dev\line-accounting\deploy\deploy.sh <admin>@<VPS_HOST>:/tmp/deploy.sh
$ sudo install -o deploy -g deploy -m 755 /tmp/deploy.sh /opt/my-services/apps/accounting/deploy.sh
$ rm /tmp/deploy.sh
$ head -1 /opt/my-services/apps/accounting/deploy.sh | od -c | head -2   # 確認沒有 \r（CRLF）
```

`deploy/deploy.sh` 日後有修改時，重複本步驟（VPS 副本不會自動更新）。

### 4. 建立部署專用 SSH 金鑰（forced command）

在開發機產生**專用、無密碼**的 ed25519 金鑰（只用於 GitHub Actions 部署）：

```powershell
PS> ssh-keygen -t ed25519 -C "gha-deploy-accounting" -N '' -f "$HOME\.ssh\accounting_deploy"
```

（若 PowerShell 版本把 `-N ''` 吃掉而提示輸入密碼，直接按兩次 Enter 即可。）

在 VPS 把公鑰加入 deploy 的 `authorized_keys`，**整行**格式如下（`restrict` 會關閉 pty、port/agent/X11 forwarding；
`command=` 讓這把 key 只能執行 deploy.sh，SSH 下的指令只會出現在 `SSH_ORIGINAL_COMMAND`）：

```text
command="/opt/my-services/apps/accounting/deploy.sh",restrict ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA...（accounting_deploy.pub 的第二欄） gha-deploy-accounting
```

```bash
$ sudo install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
$ sudo -u deploy tee -a /home/deploy/.ssh/authorized_keys >/dev/null <<'KEY'
command="/opt/my-services/apps/accounting/deploy.sh",restrict ssh-ed25519 AAAA...貼上公鑰... gha-deploy-accounting
KEY
$ sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

驗證（應回 `forbidden` 並以 exit 2 結束，代表 forced command 生效）：

```powershell
PS> ssh -i "$HOME\.ssh\accounting_deploy" -p <SSH_PORT> deploy@<VPS_HOST> "ls"
forbidden
```

### 5. 取得 known_hosts（必須人工核對指紋）

```powershell
PS> ssh-keyscan -p <SSH_PORT> -t ed25519 <VPS_HOST> > accounting_known_hosts
PS> ssh-keygen -lf accounting_known_hosts
```

```bash
$ ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub   # 兩邊 SHA256 指紋必須相同
```

`accounting_known_hosts` 的內容（port 非 22 時為 `[<VPS_HOST>]:<SSH_PORT> ssh-ed25519 AAAA...`）即 `VPS_KNOWN_HOSTS`。

### 6. GitHub 設定

Repository → Settings → Environments → New environment `production`
（建議 Deployment branches 限制為 `main`）：

| 類型     | 名稱              | 值                                                                                    |
| -------- | ----------------- | ------------------------------------------------------------------------------------- |
| Secret   | `VPS_HOST`        | VPS IP 或主機名（須與 known_hosts 中的主機名一致）                                    |
| Secret   | `VPS_PORT`        | SSH port（22 也要填）                                                                 |
| Secret   | `VPS_USER`        | `deploy`                                                                              |
| Secret   | `VPS_SSH_KEY`     | `accounting_deploy`（**私鑰**）完整內容，含 `-----BEGIN/END OPENSSH PRIVATE KEY-----` |
| Secret   | `VPS_KNOWN_HOSTS` | 步驟 5 的 `accounting_known_hosts` 完整內容                                           |
| Variable | `APP_DOMAIN`      | `accounting.ren-codes.com`（不含 `https://`、不含結尾斜線）                           |

其他：

- Settings → Actions → General → Workflow permissions：維持預設即可（workflow 內已以 `permissions` 明確宣告 `packages: write/read`）。
- 首次 push 成功後，GHCR 會建立 private package `line-accounting` 並自動連結此 repo；若改過 package 設定，確認
  Package settings → Manage Actions access 中本 repo 至少有 **Read**（deploy job 用 `GITHUB_TOKEN` 拉取）。
- 建議 `main` 分支保護：需 PR + CI 綠燈（CI 只在 `pull_request` 與 `workflow_call` 觸發；push main 由 deploy.yml 呼叫 CI，不會跑兩次）。
- 金鑰設定完成後，刪除開發機上的 `accounting_deploy` 私鑰或妥善保存（只需存在 GitHub Secret）。

### 7. LINE 平台設定（Messaging API channel 與 LINE Login channel 必須在同一個 Provider）

- Messaging API 分頁 → Webhook URL：`https://accounting.ren-codes.com/webhook/line` → **Use webhook：On** → Verify（首次部署成功後才會通過）。
- Webhook redelivery：**Off**。
- LINE Official Account Manager → 回應設定：關閉「自動回應訊息」（避免與 bot 回覆重疊）。
- LINE Login channel → LIFF：Endpoint URL `https://accounting.ren-codes.com/liff/`，Scope 含 `openid`。

---

## 首次部署

1. 完成上方 1–7（Webhook Verify 可在部署後再按）。
2. push 到 `main`（或合併 PR）→ Actions「Deploy」：CI → build → deploy → public smoke 全綠。
3. 首次部署沒有 `.last_good_tag`：若 healthcheck 失敗**不會回滾**（服務本來就是 whoami 佔位），修正後重新 push。
4. 驗證：
   ```bash
   $ cat /opt/my-services/apps/accounting/.last_good_tag
   $ tail -n 30 /opt/my-services/apps/accounting/deploy.log
   $ docker compose -p accounting -f /opt/my-services/apps/accounting/docker-compose.yml ps
   ```
   ```powershell
   PS> node scripts/smoke/remote-healthz.mjs https://accounting.ren-codes.com
   ```

## 回滾

- **自動**：新版本 healthcheck 失敗時，deploy.sh 會以 `.last_good_tag` 重新啟動上一版並讓 workflow 失敗。
- **手動（建議）**：Actions → Deploy → Run workflow → `tag` 填目標版本的完整 commit sha。不重新建置，直接部署 GHCR 上的既有映像。
- **緊急（VPS 上，管理員帳號）**：
  ```bash
  $ cd /opt/my-services/apps/accounting
  $ sudo -u deploy env APP_IMAGE="ghcr.io/s0985514623/line-accounting:$(cat .last_good_tag)" \
      docker compose -p accounting -f docker-compose.yml up -d --no-deps app
  ```
- 回滾**不回滾 migration**：migration 必須向後相容（先 expand、下一版再 contract）。

## 疑難排解

| 現象                                  | 原因 / 處理                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `forbidden` / `bad tag` / `bad actor` | SSH 指令格式錯誤；actor 須為 GitHub 帳號（`xxx[bot]` 之類的 bot actor 會被拒絕） |
| exit 75 `deploy in progress`          | 另一個部署持有 `.deploy.lock`；等待完成後重跑                                    |
| `denied` / `unauthorized`（pull）     | GHCR package 未授權本 repo Read，見步驟 6                                        |
| `Host key verification failed`        | `VPS_KNOWN_HOSTS` 與 `VPS_HOST`/`VPS_PORT` 不一致，重做步驟 5                    |
| migrate / seed 失敗                   | 服務未被更動（仍跑舊版）；檢查 `.env` 的 `DATABASE_URL` 與 `db_accounting` 網路  |
