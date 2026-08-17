# 安家 — 台灣選址房仲 Agent

用自然語言描述想要的生活條件，透過多輪對話調整權重，在地圖上找到適合的房屋物件。

Repo 分兩層：Next.js 前端在根目錄，推薦後端在 [`backend/`](backend/)（Fastify + deterministic
ranking engine + Pi agent）。兩者的整合說明見 [`docs/backend-integration.md`](docs/backend-integration.md)。

## 快速開始

```bash
# 1. 推薦後端 → http://localhost:3001（Swagger UI 在 /docs）
cd backend && pnpm install && pnpm dev

# 2. 前端
pnpm install
cp .env.example .env.local   # 需要 Gemini 路徑才要填 GEMINI_API_KEY
mkdir data                   # drizzle-kit 不會自己建目錄
pnpm db:push                 # 建立 SQLite schema
pnpm db:seed                 # 灌入示範資料
pnpm dev
```

開啟 http://localhost:3000

## 路由

| 路徑 | 內容 | agent | 排序 |
| --- | --- | --- | --- |
| `/` | 主畫面：對話、權重面板、選區、地圖、物件卡片 | `backend/` 的 Pi agent（九個 domain tools） | 後端選行政區 → `lib/scoring` 在那些區內排物件 |
| `/classic` | Gemini 對話 + 權重面板 | Gemini（`lib/agent/`） | `lib/scoring` 直接對全池 |

`/` 需要 `backend/` 有在跑；`/classic` 不需要，方便單獨驗證 scoring engine 與 Gemini 路徑。
兩頁共用同一套 `SearchProfile`、`lib/scoring`、`components/`，localStorage 的 profile key
也一樣，設定會延續。

## 指令

| 指令 | 說明 |
| --- | --- |
| `pnpm dev` | 開發伺服器 |
| `pnpm test` | 單元測試 |
| `pnpm e2e` | 端對端測試（跑 `/classic`） |
| `pnpm test:all` | 全部測試 |
| `pnpm db:push` | 建立／更新資料庫 schema |
| `pnpm db:seed` | 重新產生示範資料 |

## 架構

**LLM 不做排序，只做參數萃取與結果說明。** 排序一律由純函式的 deterministic scoring engine
執行 —— 可單元測試、毫秒回應，權重面板拖動時完全不呼叫任何模型。

`/` 這條路徑再多一層：後端的 agent 先挑出適合的行政區（分數同樣由 deterministic ranking
engine 產生，模型不編分數），前 6 個行政區才交給 `lib/scoring` 在區內排物件。

設計文件：`docs/superpowers/specs/2026-08-17-taiwan-housing-agent-design.md`

## 目前的資料

示範資料涵蓋臺北市與新北市共 20 個行政區、360 筆物件，由 `scripts/seed.ts` 確定性產生。
氣候值為中央氣象署測站氣候平均的近似值，POI 與距離為模擬值。
後端 fixture 涵蓋全台 32 個行政區，臺北／新北的清單與氣候值與 `scripts/seed.ts` 對齊。
真實資料抓取與 enrich pipeline 見計畫 B。

## ⚠️ 尚未準備好上線部署

這是本地展示用途的專案，**不要直接部署到公開網路**。`/api/chat`、`/api/rank`、`/api/agent/*`
與 `/api/backend/*` 都沒有身分驗證、沒有速率限制，`request.json()` 也沒有限制請求大小上限。
`/api/chat` 每次請求會呼叫 Gemini 兩次（萃取一次、生成解釋文字一次）——公開曝露等於讓任何人
都能免費消耗你的 API 額度與伺服器記憶體，形成成本與記憶體的阻斷服務風險。

`/api/backend/*` 尤其要注意：它是推薦後端的**無驗證全方法代理**，等於把 `backend/` 整個
公開出去。它的存在只為了讓 cloudflare tunnel 這類單一入口的 demo 能運作，
本地開發、demo 沒有問題；若要對外提供服務，至少需要加上身分驗證、速率限制與請求大小限制。
