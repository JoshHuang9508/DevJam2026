# bookworm (glibc) 而非 alpine —— better-sqlite3 的 prebuilds 有 linux-x64，
# 不需要 node-gyp 也能載入；alpine 要走 linuxmusl，多一層不確定性。
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts：better-sqlite3 的 install script 會呼叫 node-gyp，
# 但 v13 已內建 prebuilds/linux-x64.node，編譯完全沒必要。
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

ARG NEXT_PUBLIC_MAP_STYLE_URL=""
ENV NEXT_PUBLIC_MAP_STYLE_URL=$NEXT_PUBLIC_MAP_STYLE_URL

# data/app.db 有 gitignore，映像檔必須自己產生種子資料
RUN pnpm build

# 資料 pipeline 需要 tsx 與完整 devDeps，所以從 prune 之前的狀態分支出去。
# cron 跑的是這個 target（見 docker-compose.prod.yml 的 data-refresh 服務）。
FROM build AS tools
CMD ["pnpm", "fetch:data"]

FROM build AS pruned
RUN pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# 後端只在 compose 內網可見，不對外發布 port
ENV BACKEND_URL=http://backend:3001

# 先建使用者，再用 COPY --chown 一次到位。
# 分開寫 `RUN chown -R app:app /app` 會把整份 node_modules 重寫成新的一層
# —— 實測讓映像檔多了 639MB，正式機只有 9.7G 磁碟，撐不起這種浪費。
RUN groupadd -r app && useradd -r -g app app

COPY --from=pruned --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/.next ./.next
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/next.config.ts ./next.config.ts
COPY --from=build --chown=app:app /app/public ./public

USER app

EXPOSE 3000
CMD ["./node_modules/.bin/next", "start"]
