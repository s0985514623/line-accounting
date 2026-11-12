#!/usr/bin/env bash
# P2b 部署腳本靜態檢查。執行：npm run smoke:deploy-static
# 檢查項目：
#   1. bash -n deploy/deploy.sh
#   2. shellcheck（docker 映像 koalaman/shellcheck:v0.10.0）
#   3. actionlint（docker 映像 rhysd/actionlint:1.7.7）檢查 .github/workflows/deploy.yml
#   4. 若存在 deploy/compose.yml，以範例 env 跑 docker compose config
# 任一項失敗（含檔案不存在）即以非 0 結束；全部項目都會執行並彙整結果。
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

# Git Bash 會把 docker 參數中的 /src 轉成 Windows 路徑；關閉轉換。
export MSYS_NO_PATHCONV=1

SHELLCHECK_IMAGE="${SHELLCHECK_IMAGE:-koalaman/shellcheck:v0.10.0}"
ACTIONLINT_IMAGE="${ACTIONLINT_IMAGE:-rhysd/actionlint:1.7.7}"
DEPLOY_SH="deploy/deploy.sh"
DEPLOY_WF=".github/workflows/deploy.yml"
COMPOSE_FILE="deploy/compose.yml"

FAILED=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILED=$((FAILED + 1)); }

# 1. bash -n
if [ ! -f "$DEPLOY_SH" ]; then
  fail "bash -n：找不到 $DEPLOY_SH"
elif bash -n "$DEPLOY_SH"; then
  pass "bash -n $DEPLOY_SH"
else
  fail "bash -n $DEPLOY_SH 語法錯誤"
fi

# 2. shellcheck
if [ ! -f "$DEPLOY_SH" ]; then
  fail "shellcheck：找不到 $DEPLOY_SH"
elif docker run --rm -v "$ROOT/deploy:/mnt:ro" -w /mnt "$SHELLCHECK_IMAGE" -x deploy.sh; then
  pass "shellcheck $DEPLOY_SH"
else
  fail "shellcheck $DEPLOY_SH"
fi

# 3. actionlint
if [ ! -f "$DEPLOY_WF" ]; then
  fail "actionlint：找不到 $DEPLOY_WF"
elif docker run --rm -v "$ROOT:/repo:ro" -w /repo "$ACTIONLINT_IMAGE" -color "$DEPLOY_WF"; then
  pass "actionlint $DEPLOY_WF"
else
  fail "actionlint $DEPLOY_WF"
fi

# 4. docker compose config（compose.yml 存在才檢查；範例 env 僅供展開變數）
if [ -f "$COMPOSE_FILE" ]; then
  if APP_IMAGE="ghcr.io/s0985514623/line-accounting:sha-0000000" \
    docker compose -f "$COMPOSE_FILE" config --quiet; then
    pass "docker compose config $COMPOSE_FILE"
  else
    fail "docker compose config $COMPOSE_FILE"
  fi
else
  echo "SKIP  docker compose config（$COMPOSE_FILE 不存在，VPS 端 compose 為既有檔案）"
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "deploy-static-check：全部通過"
  exit 0
fi
echo "deploy-static-check：$FAILED 項失敗"
exit 1
