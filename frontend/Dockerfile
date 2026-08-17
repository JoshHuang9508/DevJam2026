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
# data/app.db 有 gitignore，映像檔必須自己產生種子資料
RUN pnpm db:push && pnpm db:seed
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
# 後端只在 compose 內網可見，不對外發布 port
ENV BACKEND_URL=http://backend:3001

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
# 這個專案沒有 public/ —— 加上去會讓 COPY 直接失敗
COPY --from=build /app/data ./data
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts

RUN groupadd -r app && useradd -r -g app app && chown -R app:app /app
USER app

EXPOSE 3000
# 直接叫 next，不要走 pnpm：corepack 會在啟動時想下載 pnpm 到 $HOME/.cache，
# 而 `useradd -r` 不會建家目錄，於是 app 使用者拿到 EACCES 無限重啟。
CMD ["./node_modules/.bin/next", "start"]
