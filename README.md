# 安家 — 台灣選址房仲 Agent

用自然語言描述想要的生活條件，透過多輪對話調整權重，在地圖上找到適合的房屋物件。

Repo 是兩個各自獨立的套件：Next.js 前端在 [`frontend/`](frontend/)，推薦後端在
[`backend/`](backend/)（Fastify + deterministic ranking engine + Pi agent）。兩邊各有自己的
`package.json`、lockfile 與 `node_modules`，沒有 monorepo workspace 串在一起，只透過 HTTP
（`BACKEND_URL`）溝通。

## 快速開始

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

開啟 http://localhost:3000

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
| `pnpm test` | 單元測試 |
| `pnpm e2e` | 端對端測試 |
| `pnpm test:all` | 全部測試 |
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

## 風水體檢

排序的第八個維度。六條常見忌諱（穿堂煞、開門見灶、開門見廁、樑壓床、明堂狹窄、路衝／壁刀）
由 `lib/fengshui` 的確定性規則引擎判定 —— 同樣**不交給 LLM**，模型只負責把「我在意風水」
轉成權重變動。物件卡片會列出命中項目、傳統說法與裝潢角度的解法建議。

**預設權重是 0**，要自己拉起來才會作用。風水是信仰性偏好，不該預設替所有人選邊站；
權重 0 也代表沒開啟時排序結果與加這功能之前逐筆相同。

**證據是模擬的。** 判斷所需的八個 `fs*` 欄位由 `scripts/seed.ts` 依屋齡、坪數、樓層等特徵
擲骰產生，**系統並沒有真的辨識任何格局圖、照片或街景圖**。卡片上寫某間房子有穿堂煞，
不代表它真的有。真實 pipeline 要接的就是這一層 —— 介面已經留好，換掉證據來源即可，
規則引擎與 UI 都不用改。

風水是文化偏好而非科學結論，系統不預測吉凶，解法建議一律以裝潢、採光與噪音的角度陳述。

## ⚠️ 尚未準備好上線部署

這是本地展示用途的專案，**不要直接部署到公開網路**。`/api/rank`、`/api/agent/*`
與 `/api/backend/*` 都沒有身分驗證、沒有速率限制，`request.json()` 也沒有限制請求大小上限。
`/api/agent/chat` 每次請求都會呼叫後端 agent 的模型——公開曝露等於讓任何人都能免費消耗你的
模型額度與伺服器記憶體，形成成本與記憶體的阻斷服務風險。

`/api/backend/*` 尤其要注意：它是推薦後端的**無驗證全方法代理**，等於把 `backend/` 整個
公開出去。它的存在只為了讓 cloudflare tunnel 這類單一入口的 demo 能運作，
本地開發、demo 沒有問題；若要對外提供服務，至少需要加上身分驗證、速率限制與請求大小限制。
