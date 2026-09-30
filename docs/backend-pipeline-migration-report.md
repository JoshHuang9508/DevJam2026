# 後端資料管線改版與升級報告

## 改版摘要

這次改版將物件資料、排序、地址定位、AI 萃取、外部資料補充、embedding 與展示格式統一移到 Fastify 後端。Next.js 不再持有 SQLite 物件資料庫，也不再計算分數或轉換物件展示資料。

新的主要資料流：

```text
backend scheduler
→ raw_sources
→ 抓取 HTML／JSON／CSV／文字
→ raw_documents 保存原始內容
→ AI 正規化最小核心資料與動態 facts
→ Nominatim 地址轉座標
→ PostgreSQL listings
→ 依 requires 執行 enrichment sources
→ 合併 facts
→ semantic_text 與 pgvector embedding
→ 後端排名並建立 view
→ 前端直接顯示
```

## 主要變更

### 儲存層

- 物件資料由前端 SQLite 移到 PostgreSQL。
- PostgreSQL 必須安裝 `vector` extension。
- 新增 `listings`、`raw_sources`、`raw_documents`、`ingestion_jobs`、`geocode_cache`、`enrichment_sources`、`enrichment_runs`。
- `facts JSONB` 保存不限種類的動態欄位及來源證據。
- `embedding vector(1536)` 與 HNSW index 負責向量召回。
- session、對話與排名快照仍由原本的 PostgreSQL repository 管理。

### 後端資料管線

- 後端 process 預設每 60 秒檢查到期的 raw source。
- raw source 只設定抓取方式，不設定房屋欄位 mapping。
- AI 可從單一文件萃取多筆物件。
- 地址、買賣模式或行政區無法確認的資料會留在 raw document 並記錄錯誤，不會進入可搜尋物件。
- 未提供的價格、坪數、屋齡、電梯等核心資料會標記為缺失，不會當成零或 `false` 參與排名。
- 相同內容與相同 normalization model 不會重複呼叫 AI；切換模型後可重新處理。

### 搜尋與前端

- `/listings/search` 在後端完成 SQL hard filter、向量召回、混合排名與展示格式。
- 每筆結果包含可直接顯示的 `view`，包括星等、價格文字、卡片細項、右欄細項、marker 與原始物件按鈕。
- `/api/rank` 和 `/api/agent/chat` 現在是純代理。
- 舊前端 scoring、SQLite、Drizzle 與資料格式化模組已移除。
- 舊資料工具保留為 opt-in 相容流程，不再是標準 Compose 啟動相依。

## 拉取此版本前必須知道的破壞性變更

1. 舊 SQLite `frontend/data/app.db` 不會自動搬到 PostgreSQL。
2. 舊 `FRONTEND_URL`、`LISTINGS_TIMEOUT_MS`、`DATABASE_PATH`、`LISTINGS_DATABASE_PATH` 不再使用。
3. PostgreSQL image 必須包含 pgvector；一般未安裝 pgvector 的 PostgreSQL 會在 migration 的 `CREATE EXTENSION vector` 失敗。
4. embedding 欄位目前固定為 1536 維。`EMBEDDING_DIMENSIONS` 和實際模型輸出必須是 1536。
5. `DETAIL_EXTRACTION_MODE=off` 時，既有 ingest API 仍可工作，但新的 raw pipeline 無法進行 AI 正規化。
6. 標準 `docker compose up` 不再自動灌示範物件。舊 seed 必須使用 `legacy-data` profile 手動執行。
7. `POST /pipeline/run`、來源管理與 enrichment 管理是內部管理 API，不應直接公開到網際網路。

## Docker Compose 升級步驟

### 1. 備份現況

```bash
cd /path/to/DevJam2026
git status
cp .env .env.before-backend-pipeline
docker compose -f docker-compose.prod.yml ps
docker volume ls | grep -E 'app-data|postgres-data'
```

如果舊 SQLite volume 內有需要保留的資料：

```bash
mkdir -p backups
docker compose -f docker-compose.prod.yml run --rm --no-deps \
  -v "$PWD/backups:/backup" data-init \
  sh -c 'if [ -f /app/data/app.db ]; then cp /app/data/app.db /backup/app-before-backend-pipeline.db; fi'
```

不要在確認新版資料可用前執行 `docker compose down -v`。

### 2. 拉取程式碼

```bash
git fetch origin
git pull --ff-only origin main
```

### 3. 更新環境變數

```bash
cp .env .env.local-backup
cat .env.example
```

在 `.env` 至少確認：

```dotenv
POSTGRES_PASSWORD=請換成正式密碼

EMBEDDING_MODE=hash
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

DETAIL_EXTRACTION_MODE=auto
DETAIL_EXTRACTION_MODEL=
DETAIL_EXTRACTION_API_KEY=

NOMINATIM_URL=https://nominatim.openstreetmap.org
NOMINATIM_USER_AGENT="zhuchao-housing-agent/0.1 (你的聯絡網址或信箱)"
NOMINATIM_EMAIL=
GEOCODE_BUDGET=250
GEOCODE_MIN_INTERVAL_MS=1100

PIPELINE_POLL_INTERVAL_MS=60000
PIPELINE_FETCH_TIMEOUT_MS=30000
```

AI 正規化至少需要下列其中一種設定。

Google：

```dotenv
DETAIL_EXTRACTION_MODE=google
DETAIL_EXTRACTION_MODEL=gemini-2.5-flash
GEMINI_API_KEY=你的金鑰
```

OpenAI 相容 API：

```dotenv
DETAIL_EXTRACTION_MODE=openai
DETAIL_EXTRACTION_MODEL=你的模型 ID
DETAIL_EXTRACTION_BASE_URL=https://api.openai.com/v1
DETAIL_EXTRACTION_API_KEY=你的金鑰
```

要使用真正的向量模型：

```dotenv
EMBEDDING_MODE=openai
EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_API_KEY=你的金鑰
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
```

### 4. 建置並執行 migration

Compose 會使用 `pgvector/pgvector:pg16`，並由 `migrate` service 自動執行 schema。

```bash
docker compose -f docker-compose.prod.yml build backend web
docker compose -f docker-compose.prod.yml up -d db
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d backend web gateway
```

也可以一次啟動：

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### 5. 確認 migration

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U postgres -d home_selector -c '\dx'

docker compose -f docker-compose.prod.yml exec -T db \
  psql -U postgres -d home_selector -c \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
```

輸出應包含 `vector` extension，以及 `listings`、`raw_sources`、`raw_documents`、`ingestion_jobs`、`enrichment_sources`。

### 6. 選擇資料初始化方式

#### 新後端 pipeline

登錄來源。以下 command 從 backend container 內呼叫私有 API：

```bash
docker compose -f docker-compose.prod.yml exec -T backend node --input-type=module -e '
const response = await fetch("http://127.0.0.1:3001/pipeline/sources/example-source", {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "範例來源",
    startUrl: "https://example.com/homes",
    documentMode: "links",
    linkPattern: "/home/[0-9]+$",
    maxDocuments: 20,
    defaultMode: "sale",
    headers: {},
    enabled: true,
    refreshMinutes: 1440
  })
});
console.log(response.status, await response.text());
'
```

手動執行一次，不需要等排程：

```bash
docker compose -f docker-compose.prod.yml exec -T backend node --input-type=module -e '
const response = await fetch("http://127.0.0.1:3001/pipeline/run", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ sourceIds: ["example-source"] })
});
console.log(response.status, await response.text());
'
```

#### 舊示範資料相容匯入

```bash
docker compose -f docker-compose.prod.yml --profile legacy-data run --rm data-init
```

舊真實資料工具仍可將結果送進新的後端 ingest API：

```bash
docker compose -f docker-compose.prod.yml --profile tools run --rm data-refresh
```

自訂的舊 SQLite 資料沒有通用 migration。必須重新爬取，或另外撰寫一次性轉換程式呼叫 `POST /listings/ingest`。

### 7. 登錄 enrichment source

```bash
docker compose -f docker-compose.prod.yml exec -T backend node --input-type=module -e '
const response = await fetch("http://127.0.0.1:3001/enrichment/sources/weather-by-location", {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "座標氣候資料",
    urlTemplate: "https://example.gov.tw/weather?lat={lat}&lng={lng}",
    scope: "listing",
    requires: ["lat", "lng"],
    enabled: true
  })
});
console.log(response.status, await response.text());
'
```

`requires` 可以是核心資料 key 或既有 fact key。後端只會對具備所有必要資料的物件執行該來源。

### 8. 驗證執行狀態

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=200 migrate backend web

docker compose -f docker-compose.prod.yml exec -T backend node --input-type=module -e '
for (const path of ["/health", "/listings/status", "/pipeline/jobs?limit=5"]) {
  const response = await fetch(`http://127.0.0.1:3001${path}`);
  console.log(path, response.status, await response.text());
}
'
```

資料庫檢查：

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U postgres -d home_selector -c \
  "SELECT status, count(*) FROM raw_documents GROUP BY status ORDER BY status;"

docker compose -f docker-compose.prod.yml exec -T db \
  psql -U postgres -d home_selector -c \
  "SELECT count(*) AS listings, count(embedding) AS embedded FROM listings;"
```

## 純本機升級步驟

### 1. 安裝 PostgreSQL 16 與 pgvector

macOS Homebrew 範例：

```bash
brew install postgresql@16 pgvector
brew services start postgresql@16
createdb home_selector
psql home_selector -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

若 Homebrew 的 pgvector 沒有安裝到 PostgreSQL 16 的 extension 路徑，改用 Compose 的 `pgvector/pgvector:pg16`，避免自行複製 extension 檔案。

### 2. 更新套件

```bash
git pull --ff-only origin main

cd backend
corepack enable
pnpm install --frozen-lockfile

cd ../frontend
pnpm install --frozen-lockfile
```

### 3. 設定 backend

```bash
cd backend
cp .env.example .env
```

至少修改：

```dotenv
DATABASE_URL=postgres://localhost:5432/home_selector
REPOSITORY_MODE=postgres
DETAIL_EXTRACTION_MODE=google
DETAIL_EXTRACTION_MODEL=gemini-2.5-flash
GEMINI_API_KEY=你的金鑰
PIPELINE_POLL_INTERVAL_MS=60000
```

### 4. Migration 與啟動

```bash
cd backend
pnpm db:migrate
pnpm build
pnpm dev
```

另一個終端：

```bash
cd frontend
cp .env.example .env.local
printf '\nBACKEND_URL=http://127.0.0.1:3001\n' >> .env.local
pnpm dev
```

### 5. 呼叫管理 API

本機 backend 直接使用 3001 port：

```bash
curl -sS http://127.0.0.1:3001/health
curl -sS http://127.0.0.1:3001/listings/status
curl -sS http://127.0.0.1:3001/pipeline/sources
curl -sS http://127.0.0.1:3001/pipeline/jobs
```

## 常用操作

停用自動排程：

```dotenv
PIPELINE_POLL_INTERVAL_MS=0
```

查看最近失敗：

```sql
SELECT id, status, error, started_at, finished_at
FROM ingestion_jobs
WHERE status IN ('failed', 'completed_with_errors')
ORDER BY started_at DESC
LIMIT 20;
```

重新處理同一份原始內容的方法：

1. 修改 `DETAIL_EXTRACTION_MODEL`，讓 normalization model key 改變。
2. 或刪除指定的 `raw_documents` 紀錄後重新執行來源。

```sql
DELETE FROM raw_documents
WHERE source_id = 'example-source';
```

清除 Nominatim negative cache 後重試地址：

```sql
DELETE FROM geocode_cache
WHERE lat IS NULL AND lng IS NULL;
```

## 回滾

回滾程式碼前先停止新版服務：

```bash
docker compose -f docker-compose.prod.yml down
git checkout 5bf2755
```

這次 PostgreSQL schema 主要是新增資料表與欄位，回滾程式碼不要求刪除它們。舊版使用 SQLite 物件資料，因此要恢復舊版功能，還必須恢復原本的 `app-data` volume 或先前備份的 `app.db`。

不要使用下列 command，除非已確認所有 PostgreSQL 與 SQLite 資料都可刪除：

```bash
docker compose -f docker-compose.prod.yml down -v
```

## 已完成驗證

```bash
cd backend
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsc -p tsconfig.build.json

cd ../frontend
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/next build --webpack

cd ..
git diff --check
```

Backend typecheck、backend production build、frontend typecheck、Next.js Webpack production build 與 whitespace 檢查均已通過。預設 Turbopack build 在目前執行環境因無法綁定內部 port 而失敗，改用 Next.js 官方支援的 `--webpack` 完成 production build。

未執行真實網站抓取與正式資料庫 migration；部署者必須在自己的 PostgreSQL/pgvector 環境完成上述 migration 與 smoke checks。
