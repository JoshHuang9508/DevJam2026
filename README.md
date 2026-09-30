# 築巢 — 台灣選址房仲 Agent

用自然語言描述生活與物件需求，由後端混合 SQL 條件、向量搜尋與 deterministic ranking，將結果呈現在地圖與物件清單。

專案包含：

- `frontend/`：Next.js 展示層，只呼叫 API、管理 UI 狀態並直接渲染後端 `view`。
- `backend/`：Fastify API、Agent、PostgreSQL/pgvector、搜尋、AI 資料正規化、地址定位與背景 enrich pipeline。
- `docs/data-structures-and-flow.md`：目前資料結構與完整資料流。
- `docs/backend-pipeline-migration-report.md`：本次後端資料管線改版與升級步驟。

## Docker 啟動

```bash
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

預設服務：

- PostgreSQL 16 + pgvector
- schema migration
- Fastify backend
- Next.js frontend
- Nginx gateway

開啟 http://localhost:3000。

標準啟動不會自動建立示範物件。物件應由 backend pipeline 抓取，或手動啟用舊相容 seed：

```bash
docker compose -f docker-compose.prod.yml --profile legacy-data run --rm data-init
```

## 本機開發

先啟動 PostgreSQL/pgvector：

```bash
docker compose up -d db
docker compose run --rm migrate
```

後端：

```bash
cd backend
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

前端：

```bash
cd frontend
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

預設網址：

- Frontend：http://127.0.0.1:3000
- Backend：http://127.0.0.1:3001
- Swagger：http://127.0.0.1:3001/docs

## 後端資料管線

```text
raw source
→ raw document
→ AI 正規化核心資料與動態 facts
→ 地址轉座標
→ listings
→ 外部 enrichment
→ embedding
→ SQL 硬篩選與向量召回
→ AI 依當次需求綜合評估
→ assessment 與後端 view
```

主要管理 API：

| API | 用途 |
| --- | --- |
| `GET /pipeline/sources` | 查看原始資料來源 |
| `PUT /pipeline/sources/:id` | 新增或更新來源 |
| `POST /pipeline/run` | 手動執行來源 |
| `GET /pipeline/jobs` | 查看最近工作 |
| `GET /enrichment/sources` | 查看補充資料來源 |
| `PUT /enrichment/sources/:id` | 新增或更新補充來源 |
| `POST /enrichment/run` | 手動執行補充資料查詢 |
| `POST /listings/search` | 搜尋及排名物件 |

後端預設每 60 秒檢查到期來源。詳細設定、來源範例、migration 與操作 command 見 [後端資料管線改版與升級報告](docs/backend-pipeline-migration-report.md)。

## AI 與 embedding

沒有 embedding key 時可使用本機 hash n-gram：

```dotenv
EMBEDDING_MODE=hash
EMBEDDING_DIMENSIONS=1536
```

Raw pipeline 必須設定 AI 正規化模型：

```dotenv
DETAIL_EXTRACTION_MODE=google
DETAIL_EXTRACTION_MODEL=gemini-2.5-flash
GEMINI_API_KEY=你的金鑰
```

或使用 OpenAI 相容 API：

```dotenv
DETAIL_EXTRACTION_MODE=openai
DETAIL_EXTRACTION_MODEL=你的模型 ID
DETAIL_EXTRACTION_BASE_URL=https://api.openai.com/v1
DETAIL_EXTRACTION_API_KEY=你的金鑰
```

搜尋評分由 AI 讀取候選物件的全部 facts 後產生。可沿用 Gemini 或自訂 OpenAI 相容服務，也可設定獨立模型：

```dotenv
ASSESSMENT_MODE=auto
ASSESSMENT_MODEL=
ASSESSMENT_BASE_URL=
ASSESSMENT_API_KEY=
```

`auto` 依序使用獨立評估金鑰、`GEMINI_API_KEY`、`CUSTOM_OPENAI_API_KEY`。都沒有或服務暫時失敗時，後端會以向量相似度降級排序並回傳較低信心度。

## 常用指令

```bash
cd backend
pnpm db:migrate
pnpm typecheck
pnpm build

cd ../frontend
pnpm typecheck
pnpm build -- --webpack
```

## 內部 API

`/pipeline/*`、`/enrichment/*`、`/listings/ingest` 與 `/api/backend/*` 沒有管理員驗證。正式環境應只允許內網或受保護的管理入口存取。`ENABLE_BACKEND_PROXY` 預設關閉。

Nominatim 查詢會序列執行、預設至少間隔 1.1 秒，並使用 PostgreSQL 快取。大量或長期商業使用應改為自架定位服務。
