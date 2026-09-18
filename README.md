# 安家 — 台灣選址房仲 Agent

用自然語言描述想要的生活條件，透過多輪對話調整權重，在地圖上找到適合的房屋物件。

Repo 是兩個各自獨立的套件：Next.js 前端在 [`frontend/`](frontend/)，推薦後端在
[`backend/`](backend/)（Fastify + deterministic ranking engine + Pi agent）。兩邊各有自己的
`package.json`、lockfile 與 `node_modules`，沒有 monorepo workspace 串在一起，只透過 HTTP
（`BACKEND_URL`）溝通。

## Docker 一鍵啟動

不需要 API key，也不需要先安裝 Node.js、PostgreSQL 或 Google Maps：

```bash
docker compose up -d --build
docker compose ps
```

開啟 http://localhost:3000。預設使用 SQLite 示範資料、記憶體 session、規則式對話模式與
OpenStreetMap 底圖；只有前端的 3000 port 會對外開放。

```bash
# 看日誌
docker compose logs -f web backend

# 停止
docker compose down

# 清掉持久化資料並重新產生示範資料
docker compose down -v
docker compose up -d --build
```

複製 [`.env.example`](.env.example) 成 `.env` 可以改 port 或開啟選用整合，但零設定就能跑。

### 免費／開源替代方案

| 原本依賴 | 預設替代 | 金鑰 |
| --- | --- | --- |
| Google Maps JavaScript API | MapLibre GL JS + OpenFreeMap（OpenStreetMap 資料） | 不需要 |
| Google Geocoding | OpenStreetMap Nominatim | 不需要 |
| Gemini 對話模型 | 本機 deterministic parser | 不需要 |
| PostgreSQL session | 容器記憶體 | 不需要 |
| 物件資料庫 | SQLite named volume | 不需要 |

地圖會顯示 OpenStreetMap attribution，也可用 `NEXT_PUBLIC_MAP_STYLE_URL` 改接自架 MapLibre style。
Nominatim 每次只會單線查詢、兩次請求至少間隔 1.1 秒、預設每輪最多新查
250 筆且結果會快取；大量或週期性地址定位應改成自架 Nominatim。

需要完整 LLM 對話時可以接免費的本機 OpenAI-compatible server（例如 Ollama）。在 `.env` 設定：

```dotenv
AGENT_MODE=pi
PI_PROVIDER=custom-openai
PI_MODEL=qwen2.5:3b
CUSTOM_OPENAI_BASE_URL=http://host.docker.internal:11434/v1
CUSTOM_OPENAI_API_KEY=ollama
```

`TWINKLE_API_KEY`、`TAVILY_API_KEY`、`CWA_API_KEY`、`MOENV_API_KEY` 都是選用；沒設定不影響示範資料與
核心搜尋流程。

### 更新真實資料

```bash
docker compose --profile tools run --rm data-refresh
docker compose restart web
```

可在 `.env` 用 `GEOCODE_BUDGET` 控制這次最多新增幾筆定位，設成 `0` 可完全略過地址 API。

## 本機開發

兩個資料夾各開一個終端機。

```bash
# 1. 推薦後端 → http://localhost:3001（Swagger UI 在 /docs）
cd backend && pnpm install && pnpm dev

# 2. 前端
cd frontend
pnpm install
cp .env.example .env.local
mkdir data                   # drizzle-kit 不會自己建目錄
pnpm db:push                 # 建立 SQLite schema
pnpm db:seed                 # 灌入示範資料
pnpm dev
```

## 路由

| 路徑 | 內容 | agent | 排序 |
| --- | --- | --- | --- |
| `/` | 主畫面：對話、權重面板、選區、地圖、物件卡片 | `backend/` 的 Pi agent（九個 domain tools） | 後端選行政區 → `lib/scoring` 在那些區內排物件 |

`/` 需要 `backend/` 有在跑；沒有它，對話與選區都無法運作。頁面用同一套
`SearchProfile`、`lib/scoring`、`components/`，設定存在 localStorage 的 profile key 下。

## 指令

以下都在 `frontend/` 下執行。

| 指令 | 說明 |
| --- | --- |
| `pnpm dev` | 開發伺服器 |
| `pnpm db:push` | 建立／更新資料庫 schema |
| `pnpm db:seed` | 重新產生示範資料 |

## 架構

**LLM 不做排序，只做參數萃取與結果說明。** 排序一律由純函式的 deterministic scoring engine
執行 —— 可單元測試、毫秒回應，權重面板拖動時完全不呼叫任何模型。

`/` 這條路徑再多一層：後端的 agent 先挑出適合的行政區（分數同樣由 deterministic ranking
engine 產生，模型不編分數），前 6 個行政區才交給 `lib/scoring` 在區內排物件。

## 目前的資料

示範資料涵蓋臺北市與新北市共 20 個行政區、360 筆物件，由 `scripts/seed.ts` 確定性產生。
氣候值為中央氣象署測站氣候平均的近似值，POI 與距離為模擬值。
後端 fixture 涵蓋全台 32 個行政區，臺北／新北的清單與氣候值與 `scripts/seed.ts` 對齊。
真實資料抓取與 enrich pipeline 見計畫 B。

## ⚠️ 尚未準備好上線部署

這是本地展示用途的專案，**不要直接部署到公開網路**。`/api/rank`、`/api/agent/*`
與 `/api/backend/*` 都沒有身分驗證、沒有速率限制，`request.json()` 也沒有限制請求大小上限。
`/api/agent/chat` 每次請求都會呼叫後端 agent 的模型——公開曝露等於讓任何人都能免費消耗你的
模型額度與伺服器記憶體，形成成本與記憶體的阻斷服務風險。

`/api/backend/*` 尤其要注意：它是推薦後端的**無驗證全方法代理**，等於把 `backend/` 整個
公開出去。它的存在只為了讓 cloudflare tunnel 這類單一入口的 demo 能運作，
本地開發、demo 沒有問題；若要對外提供服務，至少需要加上身分驗證、速率限制與請求大小限制。
