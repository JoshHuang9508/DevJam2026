# 台灣選址房仲 Agent — 設計規格

日期：2026-08-17
狀態：已核可，待撰寫實作計畫

## 1. 目標

一個限定台灣地區的房屋選址網站。使用者以自然語言描述對地區、天氣環境、地理位置、生活機能、房屋價位的偏好，透過與 agent 多輪對話逐步調整各項權重，最終在地圖上得到具體的候選物件，並附上各面向的佐證資訊。

### 1.1 已確認的範圍決策

| 決策項 | 選擇 |
| --- | --- |
| 推薦粒度 | 個別房屋物件（非行政區層級） |
| 物件資料來源 | 591 / 樂屋網 抓取 |
| 買賣 / 租賃 | 兩者都做，UI 以 toggle 切換 |
| 地理覆蓋 | 六都（台北、新北、桃園、台中、台南、高雄） |
| 專案性質 | 先做 demo，架構保留上線空間 |
| 權重表手動調整 | 納入範圍（原為可選功能） |

### 1.2 不在範圍內

- 使用者帳號、登入、對話歷史持久化（上線階段再加）
- 六都以外的縣市
- 反爬蟲繞過手段（proxy 輪替、CAPTCHA 破解、指紋偽裝）
- 物件成交、聯絡仲介等交易流程
- 房價預測模型

## 2. 技術選型

| 層 | 選擇 | 理由 |
| --- | --- | --- |
| 框架 | Next.js 15 App Router + TypeScript | 前端、API、資料腳本同一 repo 同一語言；Route Handler 直接支援 SSE 串流 |
| UI | Tailwind CSS + shadcn/ui | 權重面板、卡片、抽屜等元件快速成形 |
| 地圖 | MapLibre GL JS + OSM/Carto 免費 vector tile | 無 API token、內建 cluster、萬筆點位仍流暢 |
| 資料庫 | SQLite（better-sqlite3）+ Drizzle ORM | demo 零維運；上線換 Turso/Postgres 僅換 driver |
| LLM | Google Gemini（`@google/genai`） | 依需求指定 |
| 抓取 | 獨立 Node script（Playwright + cheerio） | 離線執行，與線上路徑完全解耦 |
| 測試 | Vitest（單元）+ Playwright（e2e smoke） | — |

已評估但未採用：

- **Vite React SPA + Python FastAPI** — Python 在抓取與資料處理上較順手，但需維護兩套 runtime、兩份部署、前後端型別手動同步。本專案資料處理集中在離線階段，不足以抵銷這些成本。
- **SvelteKit** — 最輕量、DX 佳，但地圖與 UI 元件生態較小，遇到問題需自行實作。

### 2.1 核心架構原則

**LLM 不做排序，只做參數萃取與結果說明。**

Gemini 的職責限縮為兩件事：

1. 自然語言 → 結構化的 `SearchProfile` 變動量（透過 function calling）
2. 拿排序結果 → 產生人類可讀的解釋與追問

排序由純 TypeScript 的 deterministic scoring engine 執行。此決策帶來：結果可重現、可寫單元測試、毫秒級回應、權重面板拖動時無需呼叫 API、LLM 成本與延遲可控。

**所有特徵在離線階段預先計算。** 線上查詢只讀 SQLite 並做加權算分，不呼叫任何外部 API。

## 3. 系統架構

### 3.1 離線 pipeline

```
scripts/scrape/591.ts (實作 ListingSource 介面)
        │
        ├─→ raw listings
        │
外部公開資料源
  中央氣象署 CWA 開放資料（測站氣候平均）
  環境部空氣品質 AQI
  OSM Overpass API（POI）
  內政部實價登錄（區域價格基準）
  TDX 運輸資料平台（車站點位）
        │
        └─→ scripts/enrich/*  ─→  data/app.db (SQLite)
              ├─ geocode：地址 → lat/lng
              ├─ POI 計數：500m / 1km 半徑
              ├─ 交通：最近捷運/火車站距離、市中心通勤時間
              └─ 價位：同區同型態價格百分位
```

pipeline 分階段執行且具 checkpoint，任一階段失敗可從中斷處續跑。geocode 結果永久快取。

### 3.2 線上請求流

```
使用者輸入
    │
    ▼
POST /api/chat  (Server-Sent Events)
    │
    ├─ 1. Gemini 呼叫 #1，帶 tool `update_search_profile`
    │      自然語言 → { weightsDelta, hard, soft, note }
    │
    ├─ 2. merge delta 進既有 SearchProfile，正規化權重
    │
    ├─ 3. scoring engine（純函式）→ top 30 ScoredListing
    │
    └─ 4. Gemini 呼叫 #2，餵 top 5 breakdown → 串流解釋文字
    │
    ▼
SSE events: `profile` → `results` → `text`(串流)
    │
    ▼
前端：地圖打點 + 權重面板更新 + 卡片列表重繪
```

**第二條路徑：權重面板手動調整**

```
拖動 slider → debounce 200ms → POST /api/rank { profile }
             → scoring engine → results（不呼叫 Gemini）
```

### 3.3 Repo 結構

```
app/
  page.tsx                  對話 + 地圖 主畫面
  api/chat/route.ts         SSE：萃取 → 排序 → 解釋
  api/rank/route.ts         純排序（權重面板用）
components/
  Chat/                     訊息串、輸入框、placeholder 輪播
  MapView/                  MapLibre 封裝、cluster、marker 連動
  WeightPanel/              6 條 slider、diff 高亮、reset
  ListingCard/              物件卡片、breakdown 條狀圖
  ModeToggle/               買 / 租 切換
lib/
  agent/
    client.ts               Gemini client 初始化
    prompts.ts              system prompt
    tools.ts                update_search_profile 的 JSON schema
    extract.ts              呼叫 #1 + zod 驗證 + clamp
    explain.ts              呼叫 #2 + 串流
  scoring/
    index.ts                score(profile, listings) → ScoredListing[]
    dimensions.ts           六個維度的子分數函式
    normalize.ts            候選池內 min-max 正規化
    relax.ts                0 筆時的條件放寬策略
  db/
    schema.ts               Drizzle schema
    queries.ts              hard filter 查詢
  types/
    profile.ts              SearchProfile
    listing.ts              Listing / ListingFeatures / ScoredListing
scripts/
  scrape/
    source.ts               ListingSource 介面
    591.ts                  591 adapter
    realprice.ts            實價登錄 adapter（備援物件池）
  enrich/
    geocode.ts  weather.ts  poi.ts  transit.ts  price.ts
  build-db.ts               pipeline runner
data/
  app.db                    SQLite（gitignored）
  cache/                    geocode 與外部 API 快取（gitignored）
```

### 3.4 機密處理

`GEMINI_API_KEY` 僅存於 `.env.local`，僅在 Route Handler（server 端）讀取。任何 client component 不得引用。`.env.local` 列入 `.gitignore`。

## 4. 資料模型

### 4.1 `listings`

買賣與租賃共用同一張表，以 `mode` 欄位區分。

```
id            TEXT PRIMARY KEY
source        TEXT          -- '591' | 'realprice' | ...
sourceId      TEXT
mode          TEXT          -- 'sale' | 'rent'
url           TEXT
title         TEXT
scrapedAt     INTEGER

city          TEXT          -- 六都之一
district      TEXT
address       TEXT
lat           REAL
lng           REAL

price         REAL          -- sale: 萬元總價 / rent: 元月租
unitPrice     REAL          -- sale: 萬元每坪 / rent: 元每坪
area          REAL          -- 坪
layout        TEXT          -- 例 '3房2廳2衛'
rooms         INTEGER
floor         INTEGER
totalFloor    INTEGER
age           REAL          -- 屋齡（年）
buildingType  TEXT          -- 電梯大樓 / 公寓 / 華廈 / 透天 / 套房
hasElevator   INTEGER
hasParking    INTEGER
```

### 4.2 `listing_features`（與 `listings` 1:1）

離線階段算好，線上查詢只讀此表，不呼叫外部 API。

```
listingId     TEXT PRIMARY KEY REFERENCES listings(id)

-- 天氣環境（精度到氣象測站，同行政區共用）
annualTemp        REAL
summerTemp        REAL     -- 6-8 月均溫
winterTemp        REAL     -- 12-2 月均溫
rainDays          REAL     -- 年降雨日數
humidity          REAL     -- 年均相對濕度
sunHours          REAL     -- 年日照時數
aqiMean           REAL     -- 年均 AQI

-- 生活機能（半徑內 POI 計數）
poiConvenience500, poiConvenience1k    INTEGER
poiSupermarket500, poiSupermarket1k    INTEGER
poiSchool500,      poiSchool1k         INTEGER
poiHospital500,    poiHospital1k       INTEGER
poiPark500,        poiPark1k           INTEGER
poiRestaurant500,  poiRestaurant1k     INTEGER

-- 地理位置 / 交通
distToMetro       REAL     -- 公尺，無捷運城市為 null
distToTrain       REAL
distToBus         REAL
commuteToCbdMin   REAL     -- 到該市 CBD 的估計通勤分鐘（見下方註）

-- 房屋價位脈絡
districtMedianUnitPrice  REAL
pricePercentile          REAL   -- 0..1，同區同型態同 mode 內的百分位

-- 環境負面因子（噪音 proxy）
distToMainRoad    REAL
distToRail        REAL
```

缺值一律存 `null`。scoring 遇 `null` 以同行政區中位數替補，並在該筆結果標記 `dataGaps: string[]`，UI 顯示「資料不足」。

**通勤時間的計算方式**：`commuteToCbdMin` 不做真實路徑規劃。採簡化模型 —
`直線距離 / 平均速度 + 轉乘懲罰`，其中平均速度依是否位於軌道站步行範圍（800m）內分為兩檔。
六都各自的 CBD 錨點寫死於設定檔（例：台北 = 台北車站、高雄 = 三多商圈）。
此為相對排序用的估計值，UI 需標示為「估計通勤時間」。

### 4.3 `districts`

六都的行政區清單，含邊界 GeoJSON，供地圖 choropleth 圖層（可選開關）與區域中位數計算使用。

### 4.4 `SearchProfile`（前後端唯一共享狀態）

```ts
type Mode = 'sale' | 'rent'

type WeightKey =
  | 'price'      // 房屋價位
  | 'weather'    // 天氣環境
  | 'location'   // 地理位置 / 交通
  | 'amenities'  // 生活機能
  | 'space'      // 坪數與格局
  | 'quality'    // 屋況：屋齡、樓層、電梯、車位

interface SearchProfile {
  mode: Mode

  /** 0..100，算分前正規化為總和 1 */
  weights: Record<WeightKey, number>

  /** 硬性條件：先做 filter，不進入分數計算 */
  hard: {
    cities?: string[]
    districts?: string[]
    budgetMin?: number
    budgetMax?: number
    minArea?: number
    minRooms?: number
    maxAge?: number
    buildingTypes?: string[]
    needElevator?: boolean
    needParking?: boolean
    maxDistToMetro?: number
  }

  /** 軟性偏好：調整子分數的形狀，不排除任何物件 */
  soft: {
    prefersCool?: boolean          // 怕熱
    prefersLowRain?: boolean       // 討厭多雨
    prefersQuiet?: number          // -1..1，正值偏好安靜
    commuteAnchor?: {              // 「我在信義區上班」
      lat: number
      lng: number
      label: string
      maxMin?: number
    }
  }

  /** agent 記下的口語脈絡，供解釋時引用 */
  notes: string[]
}
```

預設權重：六項各 50（等權）。`mode` 預設 `'sale'`。

切換 `mode` 時清空與新模式不相容的 `hard` 欄位（主要是 `budgetMin` / `budgetMax`，量級完全不同）。

## 5. 評分引擎

`lib/scoring` 是純函式模組，零 IO：

```ts
function score(profile: SearchProfile, pool: ListingWithFeatures[]): ScoredListing[]
```

### 5.1 流程

1. **Hard filter** — 依 `profile.hard` 與 `profile.mode` 篩選候選池
2. **若結果為 0 筆** → 進入放寬策略（見 5.4）
3. **各維度子分數** — 在候選池內計算，min-max 正規化到 0..1
4. **加權和** — `final = Σ (normalizedWeight_i × subscore_i)`
5. **多樣性 cap** — 同一行政區最多保留 5 筆
6. **取 top 30**，附上 `breakdown`

### 5.2 六個維度的子分數

| 維度 | 計算方式 |
| --- | --- |
| `price` | `1 - pricePercentile`。若設有 `budgetMax`，改用「貼近上限但不超出為佳」的曲線，避免一味推最便宜的爛物件 |
| `weather` | `summerTemp`、`winterTemp`、`rainDays`、`humidity`、`aqiMean` 的加權舒適度；`soft.prefersCool` 提高夏季溫度項權重，`soft.prefersLowRain` 提高降雨日數項權重 |
| `location` | `1 / (1 + distToMetro / 800)` 為基底；若有 `commuteAnchor`，改以到該錨點的估計通勤分鐘數為主項（同 4.2 的簡化模型，`maxMin` 作為軟性懲罰的轉折點，**不做硬性排除**）；無捷運城市改用 `distToTrain` 與 `distToBus` |
| `amenities` | `log1p(POI 計數)` 的加權和。500m 權重高於 1km。各類別權重：超商、超市、公園、醫院、學校、餐飲 |
| `space` | `area` 與 `rooms` 相對於需求（`minArea` / `minRooms`）的滿足度，超出需求邊際遞減 |
| `quality` | `age`（越新越高，30 年為明顯轉折）、`floor`（1 樓與頂樓扣分）、`hasElevator`、`hasParking`；`soft.prefersQuiet` 為正時，`distToMainRoad` 與 `distToRail` 計入 |

### 5.3 可解釋性

每筆 `ScoredListing` 附帶：

```ts
interface ScoredListing extends ListingWithFeatures {
  score: number
  breakdown: Record<WeightKey, {
    subscore: number      // 0..1
    weight: number        // 正規化後
    contribution: number  // subscore × weight
  }>
  dataGaps: string[]      // 使用替補值的欄位
}
```

卡片將 `breakdown` 直接畫成條狀圖。權重面板一動，條狀圖隨之改變 — 使用者看得見權重與結果之間的因果。

### 5.4 0 筆結果的放寬策略

依以下順序逐一放寬，每放寬一項就重試，一有結果就停：

1. `maxDistToMetro` → 放寬 50%
2. `maxAge` → 放寬 10 年
3. `minArea` → 放寬 20%
4. `budgetMax` → 放寬 15%
5. `districts` → 擴大到整個 `city`
6. 全部清除，僅保留 `mode` 與 `cities`

回傳 `relaxations: string[]` 說明放寬了什麼，agent 必須在回覆中明講。

## 6. Agent 設計

### 6.1 模型

model ID 由環境變數 `GEMINI_MODEL` 指定。萃取與解釋皆使用 flash 級模型（成本、延遲、function calling 品質的平衡點）。實作時需查閱 Google 官方文件確認當下可用的 model ID，不得憑記憶寫死。

### 6.2 Tool 定義

僅提供一個 tool：

```ts
{
  name: 'update_search_profile',
  description: '從使用者這次的發言萃取找房條件與權重的「變動量」。未提到的欄位一律省略。',
  parameters: {
    mode?: 'sale' | 'rent'
    weightsDelta?: Partial<Record<WeightKey, number>>  // -50..+50
    hard?: Partial<SearchProfile['hard']>
    soft?: Partial<SearchProfile['soft']>
    note?: string
  }
}
```

### 6.3 System prompt 的四條硬規則

1. **增量，不重寫。** 使用者說「我更在乎交通」→ 只回 `weightsDelta: { location: +20 }`，其他維度不動。後端 merge 後 clamp 到 0..100 再正規化。
2. **hard constraint 保守設定。** 只有使用者講出明確數字才寫入 `hard`。「不要太貴」→ **不設** `budgetMax`，改為 `weightsDelta: { price: +15 }`。誤設 hard filter 會把結果濾成 0 筆，是最常見的體驗災難。
3. **沒講的絕不編造。** 不推測未提及的偏好。
4. **模糊時先給結果再追問。** 不以反問卡住流程；先跑一版排序，再於回覆末尾提出一個追問。

### 6.4 解釋（Gemini 呼叫 #2）

輸入：`SearchProfile`、top 5 的 `breakdown`、`relaxations`、`dataGaps`。

要求輸出：

- 2–4 句中文
- **必須講取捨**，不只講優點。例：「這幾筆總價都壓在你的預算內，代價是屋齡普遍 30 年以上、沒有電梯」
- 若有 `relaxations`，必須明說放寬了什麼
- 結尾主動提出一個可調整方向：「要我把屋齡的權重拉高再看一次嗎？」

最後這句追問是驅動多輪權重調整的引擎。

### 6.5 對話狀態

`SearchProfile` 存於 client 的 localStorage，每次請求隨 body 送出；後端完全無狀態。訊息歷史只送最近 6 輪以控制 token。上線階段再換為 DB session。

## 7. 介面設計

### 7.1 初始畫面

置中對話框，買 / 租 toggle，輪播 placeholder 教使用者怎麼問：

```
「我在信義區上班，預算 1500 萬以內，想要安靜、生活機能好、通勤 40 分鐘內」
「想找不要太潮濕、冬天不會太冷的地方，兩房，附近要有公園跟超市」
「租屋，月租 2 萬內，捷運走路 10 分鐘，可以吵一點沒關係」
```

下方三個可點擊的範例 chip，內容同上。

### 7.2 結果畫面（桌面）

```
┌──────────────┬────────────────────────────┐
│ 對話串        │                            │
│              │       MapLibre 地圖         │
│ ──────────   │  cluster、依分數上色         │
│ 權重面板 ▼    │  點擊 marker → 卡片         │
│ （可收合）    │                            │
│ ──────────   ├────────────────────────────┤
│ 輸入框        │   結果卡片列表（橫向捲動）    │
└──────────────┴────────────────────────────┘
```

左欄固定 400px，右欄自適應。

- 卡片 hover ↔ 地圖 marker 高亮，雙向連動
- 每次有新結果時地圖 `fitBounds` 到結果範圍
- 地圖圖層開關：物件點位（預設）／行政區 choropleth（可選）。choropleth 的著色值為
  **該次結果中落在各行政區的物件平均分數**，非獨立計算的區域分數；無結果的行政區不著色

### 7.3 卡片內容

標題、價格、坪數、格局、屋齡、樓層、行政區、外部連結，加上：

- `breakdown` 六維條狀圖
- 天氣、機能、交通、價位四塊摘要數值
- `dataGaps` 標註

### 7.4 權重面板

- 六條 slider，0–100
- 拖動 → debounce 200ms → `POST /api/rank` → 地圖與卡片即時重排，**不呼叫 Gemini**
- agent 調整權重時，對應項目閃爍並顯示變化：`交通 20 → 40`
- 一鍵 reset 回等權

### 7.5 行動版

對話佔滿全螢幕，結果以 tab 切換到地圖與清單。

## 8. 錯誤處理

原則：**永不出現空畫面。**

| 狀況 | 處理 |
| --- | --- |
| Gemini 逾時或失敗 | 沿用既有 profile 照常排序，文字回覆「沒有完全聽懂，先用原本的條件給你結果」 |
| tool 回傳非法值 | zod 驗證；數值越界則 clamp；非法欄位丟棄，不讓整包失敗 |
| hard filter 濾到 0 筆 | 執行 5.4 放寬策略，並在回覆中明說放寬了什麼 |
| enrich 外部 API 缺值 | 該欄位存 null；算分時以同區中位數替補，結果標記 `dataGaps` |
| 地圖 tile 載入失敗 | 降級為灰底，點位照常顯示 |
| 抓取中斷 | pipeline 分階段 checkpoint，可從中斷處續跑 |

## 9. 測試策略

**單元測試（Vitest）**

- `lib/scoring`：
  - **單調性** — 提高 `price` 權重後，較便宜物件的排名必須上升（不可下降）
  - 正規化邊界：候選池只有 1 筆、所有值相同時不得產生 NaN
  - 放寬策略：依序觸發、`relaxations` 內容正確
  - 多樣性 cap：同區不超過 5 筆
- profile merge：delta 合併、clamp 到 0..100、`mode` 切換清空不相容 `hard` 欄位
- zod 驗證：非法 tool 輸出被正確 clamp 或丟棄

**Integration（預設 skip，需 API key）**

- 中文語句 fixture → 期望的 tool call 結構。標記為 integration，CI 不跑（會產生費用）。

**E2E（Playwright）**

- Smoke：輸入一句話 → 地圖出現點位、卡片有內容、權重面板有值
- 權重面板拖動 → 結果順序改變

## 10. 已知風險

1. **591 反爬蟲會阻擋。** 抓取器採低速率、遵守 `robots.txt`、本地快取、分階段 checkpoint。**不實作任何偵測繞過手段。** 若完全無法取得資料，`ListingSource` 直接切換為 `realprice.ts`（內政部實價登錄成交紀錄），schema 相容，demo 不會開天窗。此為備援方案，非規避手段。

2. **Geocode 是效能瓶頸。** 六都數萬筆物件，使用 Nominatim（限速 1 req/s）需數小時。因此完全放在離線階段執行，結果永久快取至 `data/cache/`，絕不進入線上請求路徑。

3. **天氣資料精度上限在氣象測站級。** 同一行政區內所有物件共用一組氣候數值。UI 必須誠實標示「區域氣候參考」，不得呈現為單一建物的微氣候。

4. **抓取資料品質不穩。** 591 的坪數、屋齡、格局欄位常有缺漏或格式不一。解析階段需容錯，缺值走 `dataGaps` 流程，不可讓單筆髒資料炸掉整個 pipeline。

## 11. 建置順序

本規格涵蓋範圍較大，實作計畫應依下列順序分階段推進。每個階段結束時系統都是可執行、可驗證的狀態。

| 階段 | 內容 | 完成判準 |
| --- | --- | --- |
| 1 | 專案骨架、Drizzle schema、型別定義、種子資料（單一城市數百筆手工/實價登錄樣本） | `pnpm dev` 可跑，DB 有資料可查 |
| 2 | scoring engine + 完整單元測試 | 單調性等測試全綠，不依賴任何 UI |
| 3 | `/api/rank` + 地圖 + 卡片 + 權重面板 | 無對話功能，但可拖 slider 看地圖結果變化 |
| 4 | Gemini 萃取 + `/api/chat` SSE + 對話 UI | 完整對話流程可跑通 |
| 5 | 抓取器與 enrich pipeline 擴充到六都、買+租完整資料 | `build-db.ts` 一鍵重建完整資料庫 |
| 6 | 錯誤處理收尾、放寬策略、e2e smoke、行動版 | 測試全綠 |

階段 1–4 使用小型種子資料即可完成，不需等待抓取。抓取（階段 5）耗時最長且風險最高，刻意排在核心流程驗證完成之後。
