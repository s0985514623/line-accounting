#!/usr/bin/env bash
# LINE 記帳 — VPS 部署腳本（deployment-runbook §7；P2b）
#
# 安裝位置：/opt/my-services/apps/accounting/deploy.sh（owner deploy，755）
# 呼叫方式：SSH forced command（authorized_keys 的 command="…"），由 GitHub Actions 執行
#   echo "$GITHUB_TOKEN" | ssh deploy@<vps> "deploy <git-sha> <github-actor>"
#   - SSH_ORIGINAL_COMMAND 只接受 `deploy <sha> <actor>`，其餘一律拒絕
#   - GHCR token 由 stdin 傳入，只用於本次 docker login，結束時 logout
#
# 流程：驗證參數 → flock → docker login → pull → prisma migrate deploy → seed 預設分類
#       → up -d → 輪詢 HEALTHCHECK（約 90 秒）→ 成功寫 .last_good_tag 並清理舊映像
#       → 失敗印 logs 並回滾到 .last_good_tag（不存在則不回滾），exit 1
#
# 注意：
#   - docker-compose.yml 由使用者管理，本腳本不覆寫；映像以 APP_IMAGE 環境變數指定
#     （shell 環境變數優先於 .env 的插值）。
#   - 回滾不回滾 migration（runbook §10）：migration 必須保持向後相容（expand → contract）。
#   - 本檔為版本控制來源；VPS 上的副本需手動更新（forced command 刻意不允許 scp）。
set -Eeuo pipefail

APP_DIR=/opt/my-services/apps/accounting
COMPOSE_FILE="$APP_DIR/docker-compose.yml"
IMAGE=ghcr.io/s0985514623/line-accounting
SERVICE=app
KEEP_IMAGES=5
HEALTH_TRIES=30   # × HEALTH_INTERVAL 秒 ≈ 90 秒
HEALTH_INTERVAL=3
COMPOSE=(docker compose -p accounting -f "$COMPOSE_FILE")

# ---- 參數驗證（forced command：只接受 deploy <sha> <actor>）----------------------
CMD="" TAG="" ACTOR=""
read -r CMD TAG ACTOR _ <<< "${SSH_ORIGINAL_COMMAND:-}" || true
[[ "$CMD" == "deploy" ]] || { echo "forbidden" >&2; exit 2; }
[[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]] || { echo "bad tag" >&2; exit 2; }
[[ "$ACTOR" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$ ]] || { echo "bad actor" >&2; exit 2; }
[[ -f "$COMPOSE_FILE" ]] || { echo "missing $COMPOSE_FILE" >&2; exit 2; }

# ---- 序列化：同時只允許一個部署 --------------------------------------------------
exec 9>"$APP_DIR/.deploy.lock"
flock -n 9 || { echo "deploy in progress" >&2; exit 75; }

log() { echo "[$(date -Is)] $*" | tee -a "$APP_DIR/deploy.log"; }

# ---- 等待容器 healthy；回傳 0 = healthy ------------------------------------------
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
  log "health check timeout"
  return 1
}

# ---- 只清理本應用的舊映像（保留目前版本 + 最新 KEEP_IMAGES-1 個）-------------------
# 共用 VPS 上絕不可用 `docker image prune -a`（會刪到其他 app 的映像）。
prune_images() {
  local old
  docker images "$IMAGE" --format '{{.Tag}}' \
    | grep -vx -e "$TAG" -e '<none>' \
    | tail -n +"$KEEP_IMAGES" \
    | while read -r old; do
        docker rmi "$IMAGE:$old" >/dev/null 2>&1 || true
      done
}

# ---- GHCR 登入（token 由 stdin）-------------------------------------------------
docker login ghcr.io -u "$ACTOR" --password-stdin >/dev/null
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

log "deploy $TAG by $ACTOR"
docker pull --quiet "$IMAGE:$TAG"
export APP_IMAGE="$IMAGE:$TAG"

log "migrate"
if ! "${COMPOSE[@]}" run --rm -T --no-deps "$SERVICE" node_modules/.bin/prisma migrate deploy < /dev/null; then
  log "FAILED migrate $TAG（服務未變更）"
  exit 1
fi

log "seed defaults"
if ! "${COMPOSE[@]}" run --rm -T --no-deps "$SERVICE" node dist/cli/seed-defaults.js < /dev/null; then
  log "FAILED seed $TAG（服務未變更）"
  exit 1
fi

log "up"
if "${COMPOSE[@]}" up -d --no-deps "$SERVICE" && wait_healthy; then
  echo "$TAG" > "$APP_DIR/.last_good_tag"
  log "healthy $TAG"
  prune_images || true
  exit 0
fi

# ---- 失敗：印 logs 並回滾 --------------------------------------------------------
log "UNHEALTHY $TAG"
"${COMPOSE[@]}" logs --no-color --tail 100 "$SERVICE" || true

if [[ -f "$APP_DIR/.last_good_tag" ]]; then
  PREV="$(< "$APP_DIR/.last_good_tag")"
  if [[ "$PREV" =~ ^[0-9a-f]{7,40}$ ]]; then
    log "rollback → $PREV"
    export APP_IMAGE="$IMAGE:$PREV"
    "${COMPOSE[@]}" up -d --no-deps "$SERVICE" || true
    if wait_healthy; then
      log "rollback healthy $PREV"
    else
      log "rollback UNHEALTHY $PREV（需人工處理）"
    fi
  else
    log ".last_good_tag 內容無效，不回滾"
  fi
else
  log "無 .last_good_tag（首次部署），不回滾"
fi
exit 1
