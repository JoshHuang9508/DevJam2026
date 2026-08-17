FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
# 綁 0.0.0.0 是為了讓 compose 內網的前端連得到；
# 這個 port 不會發布到主機，外部無法直接觸及（見 docker-compose.prod.yml）。
ENV HOST=0.0.0.0
ENV PORT=3001
# 沒有 PostgreSQL 就用記憶體模式；重啟會清掉 session
ENV REPOSITORY_MODE=memory

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

RUN groupadd -r app && useradd -r -g app app && chown -R app:app /app
USER app

EXPOSE 3001
CMD ["node", "dist/index.js"]
