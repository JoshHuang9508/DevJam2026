# 前端 ↔ 推薦後端整合

更新：2026-08-17（對齊 `65cb4e6` 的七維 scoring engine）

`backend/`（Fastify + Pi agent + deterministic ranking engine）接進這個 Next.js app。

## 路由

| 路徑 | 內容 | agent | 排序 |
| --- | --- | --- | --- |
| `/` | 主畫面：對話 + 權重面板 + 選區 + 地圖 + 物件卡片 | 後端 Pi agent（十個 domain tools） | 後端選行政區 → `lib/scoring` 在那些區內排物件 |
| `/classic` | 只有權重面板的原始畫面，無對話層 | 無 | `lib/scoring` 直接對全池 |

`/classic` 保留下來方便單獨驗證 scoring engine，也是接後端之前的原始主畫面。
兩頁共用同一套 `SearchProfile`、`lib/scoring`、`components/`、`hooks/useSearchState`，
localStorage 的 profile key 也一樣（`housing-agent.profile.v1`），設定會延續。

Josh 原本的 Gemini 路徑（`lib/agent/`、`app/api/chat`）沒有被刪除，只是目前沒有畫面在用；
要切回去把 `app/page.tsx` 指向 `/classic` 的內容再接上 `/api/chat` 即可。

## 主畫面的流程

```
使用者輸入
   │
   ├─ 1. client SearchProfile ──toPreferencePatch──> 後端 PreferenceState
   │       （先吸收使用者手動拉過的 slider，agent 才從正確狀態開始推理）
   │
   ├─ 2. 後端 Pi agent 跑一輪：update_preferences / rank_candidates / get_* 等工具
   │       分數一律由 deterministic ranking engine 產生，模型不編分數
   │
   ├─ 3. ranking.updated ──toSearchProfile──> SearchProfile
   │       後端排名的前 6 個行政區 → hard.districts
   │
   ├─ 4. lib/scoring 在那些行政區內排物件（含放寬策略與多樣性上限）
   │
   └─ 5. SSE 回傳
```

SSE 事件沿用 `/api/chat` 的名稱（`profile` / `results` / `text` / `done` / `error`），
另加 `session`（後端 session id，存 localStorage）與 `districts`（行政區排名，畫成地圖上方的選區卡片）。
因為事件名一致，UI 的 reducer 兩邊可以共用。

**權重面板走的是 Josh 原本的 `/api/rank`**，不碰後端也不呼叫模型 —— 拖 slider 只重排物件，
不會重新選區。要換一批行政區就用對話。這個分工是刻意的，也讓 slider 維持零延遲。

## 權重軸的對應（5 ↔ 8）

後端排序用五維、前端八維，兩邊都不是對方的子集，所以雙向都有損：

| 前端 | 後端 | 說明 |
| --- | --- | --- |
| `price` + `value` | `softPreferences.housing.weight` | 2:1。送出取平均；回來時兩條一起位移，保留使用者自己拉開的差距 |
| `weather` | `softPreferences.climate.weight` | 1:1 |
| `location` | `softPreferences.transportation.weight` | 1:1 |
| `amenities` | `softPreferences.amenities.weight` | 1:1 |
| `fengshui` | `listingPreferences.fengshuiWeight` | 1:1。**不在 `softPreferences` 裡** —— 後端只存不排，見下 |
| `space`、`quality` | 無 | 物件層級屬性，行政區沒有對應，**永遠不會被後端覆寫** |
| 無 | `softPreferences.geography.weight` | 只影響選區，權重面板上看不到 |

`listingPreferences` 是刻意獨立於 `softPreferences` 的一個區塊：行政區沒有「風水」這種屬性
（穿堂煞是某一戶的格局），所以排序引擎完全不讀它，後端只負責存下來再回傳。它存在的唯一理由是
**agent 是目前唯一的萃取器** —— 前端的 Gemini 路徑在 `7c5bdaf` 移除後，「我很在意風水」
「絕對不要穿堂煞」沒有別的地方可以被轉成條件。`hard.avoidFengshui` 走同一條路往返。

送出時 `avoidFengshui` 一律送（包含空陣列）：後端的 deep-merge 會跳過 `undefined`，
省略欄位等於「不要動」，那就永遠清不掉已經設過的避開項。

硬條件同樣分層：地區／城市／租金在後端，坪數／格局／屋齡／電梯／車位留在物件層級原封不動。
`mode` 由前端的買賣/租賃 toggle 決定；後端只模型化月租，所以 **買房模式下預算不會送到後端**
（萬元總價與元月租量級差太多）。

## 檔案

```
新增
  lib/backend/{types,client,sse-client,listings,profile-bridge}.ts
  app/api/agent/{chat,session}/route.ts
  components/AgentApp/{AgentApp,DistrictStrip}.tsx
  app/classic/page.tsx（原始無對話畫面）
  backend/vitest.config.ts

改到的既有檔案
  .env.example  +3 行（BACKEND_URL）
  .gitignore    +6 行（backend 的 .env / dist / coverage）
```

## 種子資料覆蓋率

後端有 32 個行政區（全台），`data/app.db` 只有臺北市 12 區 + 新北市 8 區。
`/api/agent/chat` 會先把選區結果跟種子涵蓋範圍取交集再當成 hard filter；
完全沒交集時直接拿掉 `hard.districts` 並在 `relaxations` 說明原因 ——
否則放寬策略會誤報「放寬預算」，把真正的原因蓋掉。

後端 fixture 的臺北／新北區清單與氣候值已經對齊 `scripts/seed.ts`，同一個區兩邊講的是同一件事。

## 跑起來

```bash
cd backend && pnpm install && pnpm dev     # http://localhost:3001
pnpm install && pnpm db:push && pnpm db:seed
pnpm dev                                   # http://localhost:3000
```

`pnpm db:push` 前要先 `mkdir data`，drizzle-kit 不會自己建目錄。

## Agent runtime

畫面左上角的徽章顯示目前跑哪一個：

| runtime | 條件 |
| --- | --- |
| `pi-agent-core` | `AGENT_MODE=auto` 且 model provider 有設定 |
| `deterministic-fallback` | 沒有可用的 provider；規則式解析，只認得驗收詞彙 |

目前接本地 OpenAI 相容伺服器（`backend/.env`）：

```dotenv
PI_PROVIDER=custom-openai
PI_MODEL=gpt-5.6-terra
CUSTOM_OPENAI_BASE_URL=http://127.0.0.1:8080/v1
CUSTOM_OPENAI_CONTEXT_WINDOW=272000
```

換 provider 只要改 `backend/.env` 重啟後端，前端不用改。

## 都市計畫使用分區（真實圖資）

後端多了一支跟 session 無關的 `POST /urban-plan`，以 WGS84 座標直接查三個官方系統：

| 縣市 | 來源 | 拿得到什麼 |
| --- | --- | --- |
| 臺北市 | [UPIS v2](https://webgis.udd.gov.taipei/upis_v2) | 使用分區、分區代碼、歷年都市計畫案（含公告文號）、都更／山坡地／禁限建／都審範圍 |
| 新北市 | [城鄉資訊查詢平台](https://urban.planning.ntpc.gov.tw/NtpcURInfo/Map.aspx) | 用地類別、**建蔽率**、**容積率**、所屬都市計畫、細部計畫、免建築線／禁建線 |
| 基隆市 | [都市計畫整合查詢](https://upgis.klcg.gov.tw/KL_LAND/) | 使用分區、主要計畫區、細部計畫區、都計案範圍 |

這是後端目前唯一的非 fixture 資料（`isFixture: false`）。agent 側對應工具 `get_urban_plan`。

物件卡片要顯示分區的話，`ListingCard` 已經有 `lat`/`lng`，打這支即可 —— 它不需要 session，
結果在後端有快取（預設 24 小時），同一個座標重打是 0ms。**前端目前還沒接**，是刻意留給 UI 決定
要放在卡片上還是詳情裡。

回傳的 `match` 一定要照實顯示：`parcel` 才是該座標所在的分區圖形；`nearby` 是座標落在道路或
河川（這些沒有分區圖形）時取的周邊參考值，不等同該地號的法定分區；`none` 是查無。
`buildingCoveragePct` / `floorAreaRatioPct` 為 `null` 就是來源沒給，不要自己補行情值。

## 已知落差

- 後端沒有「清除欄位」的 patch 表示法（`undefined` 會被 deep-merge 跳過），所以清掉預算上限不會同步到後端，只會變大。
  陣列型欄位不受影響 —— deep-merge 對陣列是整體覆寫，所以 `avoidFengshui: []` 真的清得掉。
- 每輪送出的 patch 失敗時是被 `.catch(() => undefined)` 吞掉的。這種情況下後端狀態會落後於前端，
  而回讀會把使用者手動拉過的滑桿蓋回舊值。這是四條後端軸與 `fengshui` 共有的既有風險，不是風水獨有。
- 後端的 `maxCommuteMinutes` 有欄位但沒有 route-time provider，設了不生效；前端的 `soft.commuteAnchor` 也不會送到後端。
- 拖 slider 不會重新選區（見上）。
- 兩邊的**行政區與房源**都是示範資料：後端 `fixture-v1`，前端 `scripts/seed.ts`，都不是真實房源。
  （唯一的例外是上面那節的都市計畫圖資，那是真的。）
- 都市計畫圖資只涵蓋臺北市、新北市、基隆市；其他縣市會回 400。
