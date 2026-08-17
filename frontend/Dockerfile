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

# NEXT_PUBLIC_* 是 next build 時就編進瀏覽器 bundle 的，不是執行期讀的。
# 放在 compose 的 environment 沒有用 —— 前端會拿到空字串。必須走 build arg。
# 也因此這裡只能放本來就會公開的值（金鑰會出現在 bundle 與 docker history 裡），
# GEMINI_API_KEY 那種絕對不能用這條路。
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=""
ARG NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=""
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ENV NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=$NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID

# data/app.db 有 gitignore，映像檔必須自己產生種子資料
RUN pnpm db:push && pnpm db:seed
RUN pnpm build

# 資料 pipeline 需要 tsx 與完整 devDeps，所以從 prune 之前的狀態分支出去。
# cron 跑的是這個 target（見 docker-compose.prod.yml 的 data-refresh 服務）。
FROM build AS tools
CMD ["pnpm", "fetch:data"]

FROM build AS pruned
# 執行期用不到 typescript / tailwind / drizzle-kit / tsx，
# 就地砍成 production 依賴，runtime stage 直接拿這一份。
RUN pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
# 後端只在 compose 內網可見，不對外發布 port
ENV BACKEND_URL=http://backend:3001

# 先建使用者，再用 COPY --chown 一次到位。
# 分開寫 `RUN chown -R app:app /app` 會把整份 node_modules 重寫成新的一層
# —— 實測讓映像檔多了 639MB，正式機只有 9.7G 磁碟，撐不起這種浪費。
RUN groupadd -r app && useradd -r -g app app

COPY --from=pruned --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/.next ./.next
# 這個專案沒有 public/ —— 加上去會讓 COPY 直接失敗
COPY --from=build --chown=app:app /app/data ./data
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/next.config.ts ./next.config.ts

USER app

EXPOSE 3000
# 直接叫 next，不要走 pnpm：corepack 會在啟動時想下載 pnpm 到 $HOME/.cache，
# 而 `useradd -r` 不建家目錄，於是 app 使用者拿到 EACCES 無限重啟。
CMD ["./node_modules/.bin/next", "start"]
