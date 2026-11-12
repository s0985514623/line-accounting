# syntax=docker/dockerfile:1.7
# LINE 記帳 — 正式映像（deployment-runbook §2；Q-1 決策：Node 24 LTS）
#
# 執行期指令（同一映像）：
#   node dist/server.js                         預設 CMD：HTTP 服務
#   node_modules/.bin/prisma migrate deploy     部署時套用 migration
#   node dist/cli/seed-defaults.js              部署時建立預設分類（= npm run seed:defaults:prod）
#
# Prisma engine：prisma generate 與 engine 下載皆在本映像（debian bookworm + OpenSSL 3）內執行，
# "native" binaryTarget 即解析為 debian-openssl-3.0.x，故 schema.prisma 無須設定 binaryTargets。
ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- 完整依賴（含 devDependencies；建構用）------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---- 建構：後端 TypeScript → dist/；LIFF 前端 → web/dist/（P8 前 web/ 尚不存在）----
FROM deps AS build
COPY . .
RUN npx prisma generate \
 && npm run build \
 && if [ -f web/package.json ]; then \
      npm --prefix web ci && npm --prefix web run build; \
    else \
      mkdir -p web/dist; \
    fi

# ---- 正式依賴（prisma CLI 在 dependencies：執行期 migrate deploy 用）-----------
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev \
 && npx prisma generate \
 && npm cache clean --force

# ---- 執行期 -------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production PORT=3000
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY prisma ./prisma
COPY package.json ./
# P2b：deploy/compose.yml 建立後於此加入 `COPY deploy/compose.yml ./deploy/compose.yml`（deploy.sh 由映像取出）
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
