# 後端動態 Facts 資料模型改版報告

## 改版結果

物件資料已改為「地址 + 動態 facts」模型：

- `address` 是唯一固定的房屋內容欄位。
- 名稱、交易類型、縣市、行政區、價格、坪數、格局、樓層、屋齡、設備與環境資訊全部存入 `facts`。
- `details` 與 `features` 已移除。
- 搜尋必要條件直接查詢 facts 的 typed `value`。
- embedding 內容由地址與所有 facts 組成。
- AI 讀取候選物件的所有 facts，依每次搜尋需求產生整體分數與說明。
- 前端舊 seed、資料下載與合併腳本已移除。

## 對既有後端的影響

這是破壞性 migration。舊 `listings` 只要仍有 `mode` 欄位，migration 會先執行 `TRUNCATE TABLE listings CASCADE`，再刪除舊欄位。現有物件及其 enrichment run 會被清空，來源設定、原始文件、工作紀錄與地址快取會保留。

舊後端若拉取這次變更，需完成以下事項：

1. 停止仍在執行的舊版資料匯入工作。
2. 備份資料庫。
3. 拉取程式碼並安裝依賴。
4. 設定 AI normalizer 與 embedding 環境變數。
5. 執行 schema migration。
6. 重新建置並啟動 backend 與 frontend。
7. 確認或新增 `raw_sources`。
8. 執行 backend pipeline 重新抓取物件。
9. 檢查工作狀態與資料數量。

## Docker 升級指令

在 repo 根目錄執行：

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U postgres -d home_selector -Fc \
  > "home_selector-before-dynamic-facts-$(date +%Y%m%d-%H%M%S).dump"

git pull
cp .env.example .env
docker compose -f docker-compose.prod.yml build backend web migrate
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d backend web gateway
docker compose -f docker-compose.prod.yml ps
```

`.env` 至少要設定一組 AI normalizer：

```dotenv
FACT_EXTRACTION_MODE=google
FACT_EXTRACTION_MODEL=gemini-2.5-flash
GEMINI_API_KEY=your-key
EMBEDDING_MODE=hash
EMBEDDING_DIMENSIONS=1536
```

也可使用 OpenAI 相容服務：

```dotenv
FACT_EXTRACTION_MODE=openai
FACT_EXTRACTION_MODEL=your-model
FACT_EXTRACTION_BASE_URL=https://api.openai.com/v1
FACT_EXTRACTION_API_KEY=your-key
```

## 本機升級指令

```bash
git pull

cd backend
corepack enable
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build

cd ../frontend
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

## 設定來源

```bash
curl -X PUT http://127.0.0.1:3001/pipeline/sources/example-rent \
  -H 'content-type: application/json' \
  -d '{
    "name": "Example Rent",
    "startUrl": "https://example.com/rent.json",
    "documentMode": "json",
    "maxDocuments": 20,
    "defaultMode": "rent",
    "headers": {},
    "enabled": true,
    "refreshMinutes": 1440
  }'

curl http://127.0.0.1:3001/pipeline/sources
```

## 重新建立物件資料

執行全部到期來源：

```bash
curl -X POST http://127.0.0.1:3001/pipeline/run \
  -H 'content-type: application/json' \
  -d '{}'
```

執行指定來源：

```bash
curl -X POST http://127.0.0.1:3001/pipeline/run \
  -H 'content-type: application/json' \
  -d '{"sourceIds":["example-rent"]}'
```

後端也會依 `PIPELINE_POLL_INTERVAL_MS` 檢查到期來源，不需要任何前端程序或 compose tools service。

## 驗證指令

```bash
curl http://127.0.0.1:3001/health
curl 'http://127.0.0.1:3001/pipeline/jobs?limit=10'

docker compose -f docker-compose.prod.yml exec -T db \
  psql -U postgres -d home_selector -c \
  "SELECT count(*) AS listings, count(embedding) AS embedded FROM listings;"

docker compose -f docker-compose.prod.yml exec -T db \
  psql -U postgres -d home_selector -c \
  "SELECT address, jsonb_array_length(facts) AS fact_count, extraction_model FROM listings ORDER BY indexed_at DESC LIMIT 10;"
```

搜尋 smoke check：

```bash
curl -X POST http://127.0.0.1:3001/listings/search \
  -H 'content-type: application/json' \
  -d '{
    "profile": {"mode": "rent", "hard": {}},
    "semanticQuery": "採光好、有電梯、走路可到捷運",
    "limit": 5
  }'
```

預期每筆結果包含 `source`、`location`、`facts`、`assessment` 與 `view`，不再包含舊的固定物件欄位、`details` 或 `features`。

## 回復方式

由於 migration 會移除舊欄位，程式碼 rollback 必須同時還原 migration 前的資料庫備份：

```bash
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d db

cat home_selector-before-dynamic-facts-YYYYMMDD-HHMMSS.dump | \
  docker compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U postgres -d home_selector --clean --if-exists
```
