# 地圖優先 UI 改版 — 設計規格

日期：2026-08-17
狀態：待核可

## 1. 目標

把 `/` 從「三塊固定面板堆在一起」改成**地圖優先**的介面：入口置中出現，送出後地圖從右滑入，物件列停右側可收納，權重面板改為浮動視窗，地圖圖示可 hover 預覽、點選鎖定並放大置中。

前一版的問題是所有東西同時常駐，地圖被擠成中間一條，而地圖才是「選址」這件事的主角。

## 2. 範圍變更：移除 Gemini 路徑與 `/classic`

使用者決定只保留一條 agent 路徑（Fastify / pi-agent-core），並統一使用 `/` 目前的 `neutral-900` 配色。

### 2.1 刪除

| 路徑 | 說明 |
| --- | --- |
| `app/classic/page.tsx` | 舊主畫面 |
| `app/api/chat/route.ts` | Gemini SSE 端點 |
| `components/Chat/` | `Landing` / `ChatPanel` / `Composer` |
| `components/HardConstraints/` | 只有 `/classic` 使用 |
| `hooks/useChat.ts` | 只有 `/classic` 使用 |
| `lib/agent/` | `client` `extract` `explain` `prompts` `tools` 與其測試 |

`.env.example` 移除 `GEMINI_API_KEY` / `GEMINI_MODEL`；README 移除「Gemini 路徑尚未經過品質驗證」整節。

**代價，明白記錄**：Gemini 萃取與解釋（含四條硬規則的 prompt 設計、21 個單元測試、4 個整合測試）就此離開程式碼庫。使用者原本打算自行驗證的 Gemini 品質，不再有介面也不再有測試。git 歷史仍可取回。

### 2.2 保留並整併

| 路徑 | 處置 |
| --- | --- |
| `lib/sse.ts` | **留** —— `/api/agent/chat` 也在用，不專屬 Gemini |
| `lib/client/sseClient.ts` | **留，且 `AgentApp` 改用它** |
| `lib/types/chat.ts` | **留** —— 擴充 `id` / `streaming`，`AgentApp` 改用 |
| `lib/client/placeholders.ts` | **留** —— 內容換成 `AgentApp` 現有的 `EXAMPLES` 三句（月租／中南部那組），輪播常數保留 |

`AgentApp` 現在自己內嵌一份 SSE 解析（手動找 `\n\n`、切 `event:` / `data:`）。`parseSseChunk` 做的是同一件事，且有 6 個測試覆蓋跨 chunk 邊界、多事件同批、壞 JSON 只跳過該事件。整併後 `AgentApp` 的串流解析白得這些覆蓋。

## 3. 版面與轉場

### 3.1 兩個狀態，同一棵樹

```
started = false                     started = true
┌──────────────────────┐            ┌──────┬─────────────┬────┐
│                      │            │ 對話 │             │物件│
│       安家            │  ────────▶ │      │    地圖      │ 欄 │
│   〔買房〕〔租房〕      │   240ms    │ 修改 │  從右滑入    │ ◀  │
│  ┌──────────┐〔送出〕  │            │ 權重 │             │    │
│  └──────────┘         │            │      │             │    │
│    ○ ○ ○  例句        │            │      │             │    │
└──────────────────────┘            └──────┴─────────────┴────┘
      380px 置中                      380px      自適應     320px
```

**不換 route，也不替換元件。** 入口與工作畫面是同一棵 React 樹，`started` 只驅動 CSS `transform`。入口卡片從置中平移到左欄；地圖容器由 `translateX(100%)` 滑到 `0`。

**入口不得重新掛載** —— 重新掛載會清掉輸入框內容與焦點，使用者送出後若動畫期間想補字就會失去內容。

**地圖實例只建立一次。** MapLibre 重新掛載會重抓圖磚、丟失相機狀態，滑入時會看到閃白。首次送出時掛載，之後只動外層容器。

轉場 240ms `ease-out`。尊重 `prefers-reduced-motion`：該設定開啟時直接切換不做位移動畫。

### 3.2 入口內容

沿用 `/` 現有的黑色系與文案，加回置中排版：

- 標題「安家」+ 一句說明
- 買 / 租 toggle
- 輸入框（`placeholders.ts` 輪播，4.5 秒換一句）
- 三個例句 chip，點擊直接送出。`AgentApp` 內嵌的 `EXAMPLES` 移進 `placeholders.ts`，兩處共用同一份
- 底部一行示範資料聲明
- 後端狀態燈（`AgentApp` 既有）移到入口右上

### 3.3 行動版

三欄在手機上放不下。斷點 `md`（768px）以下改為單欄 + 分頁：

```
┌─────────────────────┐
│ 〔對話〕〔地圖〕〔物件〕│  ← 分頁列
├─────────────────────┤
│                     │
│    當前分頁內容        │
│                     │
└─────────────────────┘
```

- 入口在手機上一樣置中，送出後自動切到「地圖」分頁
- 權重浮動面板在手機上改為由下方滑入的半屏面板（錨定式浮層在窄螢幕會超出邊界）
- 物件欄的收納軌在手機上不存在——它本身就是一個分頁

## 4. 地圖互動

### 4.1 hover 與選取是兩個獨立狀態

```ts
hoveredId:  string | null   // 滑鼠移開即消失
selectedId: string | null   // 點選後常駐，直到主動關閉
```

**必須分開。** 合成一個的話，「點選後滑鼠移開卡片就消失」——常駐失效。

| 動作 | 結果 |
| --- | --- |
| hover 地圖圖示 | 浮動卡片出現在圖示旁 |
| hover 右欄卡片 | 只讓對應圖示放大（既有行為），**不**開浮動卡片 |
| 點地圖圖示 | `selectedId` = 該筆、`flyTo` 放大置中、卡片釘住 |
| 點右欄卡片 | 同上 |
| 點地圖空白 / ✕ / ESC | 清除 `selectedId` |

hover 右欄卡片刻意不開浮動卡片：右欄那張卡已經是完整資訊，地圖上再開一張同樣內容的會變成兩張一樣的卡片。

### 4.2 卡片錨定機制

**先講一個前提：地圖上沒有 cluster，圖示是 DOM `Marker` 不是 canvas 圖層。**
`MapView` 已在先前改版中從 geojson source + circle layer 換成 DOM Marker，原因寫在該檔註解：
maplibre 的 geojson source 一律在 web worker 切磚，而這個 Next/Turbopack 環境下 worker
一建立就被關掉，source 永遠停在 loading —— `setData` 收得到資料、`fitBounds` 照跑，
但一個點都畫不出來，且不拋任何錯誤。所以本規格不含任何 cluster 行為。

卡片仍用 `map.project([lng, lat])` 定位，不改用 marker 的 `getBoundingClientRect()`：
前者只依賴經緯度與相機狀態，後者依賴 DOM 佈局時序，在 marker 重建的那一幀會讀到舊位置。

每次相機變動用 `map.project([lng, lat])` 換算像素定位：

```
map.on('move') ─┐
map.on('zoom') ─┼─▶ requestAnimationFrame 節流 ─▶ project() ─▶ 卡片 left/top
map.on('resize')┘
```

**必須用 rAF 節流。** `move` 在拖曳時每幀觸發，直接 `setState` 會抖動並掉幀。

**邊緣翻轉**：圖示靠近右緣時卡片改開左側，靠近下緣時往上開。否則選到邊上的物件，卡片一半在畫面外。

### 4.3 放大置中

```ts
map.flyTo({ center: [lng, lat], zoom: 15, duration: 600 })
```

`prefers-reduced-motion` 開啟時改用 `jumpTo`。

## 5. 權重浮動面板

左欄一行「修改權重」文字按鈕開啟。**不加遮罩、不阻擋操作** —— 這個面板的價值就是拖動時看著地圖與卡片即時重排，加 backdrop 會遮住該看的東西。

- 錨定在觸發文字旁，寬 320px
- 點外面或 ESC 關閉
- `WeightPanel` **內部完全不動**：七條 slider、`aria-label` 在 `Slider.Thumb`、agent 調整時的 `50 → 70` 閃爍全部保留

## 6. 物件欄

右側直向列，寬 320px，可收納。

- 展開：卡片直向堆疊，捲動
- 收納：留一條 40px 窄軌，顯示筆數與展開箭頭

收納後不整個消失換成浮鈕 —— 留著「有 30 筆」的提示，使用者才不會忘記它存在。

`ListingCard` 與 `BreakdownBars` **完全不動** —— 它們已在先前改版中轉為 neutral
（hover 是 `border-neutral-800`、breakdown 條是 `bg-neutral-700`）。

唯一殘留的藍色在 `WeightPanel` 第 47 行，agent 調整權重時那個 `50 → 70` 徽章仍是
`bg-blue-50` / `text-blue-700` / `ring-blue-200`。統一到 neutral 系。

`ResultStrip`（橫向）由 `ListingList`（直向 + 收納）取代。

## 7. 元件盤點

| 檔案 | 動作 |
| --- | --- |
| `components/AgentApp/AgentApp.tsx` | 版面重寫；串流改用 `parseSseChunk` |
| `components/AgentApp/Entrance.tsx` | 新增 —— 置中入口 |
| `components/MapView/MapView.tsx` | 加 `selectedId`、`flyTo`、cluster 放大、投影錨點 |
| `components/MapView/MapCard.tsx` | 新增 —— 錨定圖示的浮動卡片 |
| `components/WeightPanel/WeightPopover.tsx` | 新增 —— 包住 `WeightPanel` |
| `components/ListingList/ListingList.tsx` | 新增 —— 取代 `ResultStrip` |
| `components/ListingCard/ResultStrip.tsx` | 刪除 |

## 8. 測試影響

### 8.1 現況

e2e 8 個測試全部指向 `/classic`，該頁即將刪除。`AgentApp` 目前 **零 `data-testid`**，沒有任何 e2e 覆蓋。

### 8.2 重建

e2e 對新 `/` 重寫。

現有 `data-testid` 盤點：

| testid | 位置 | 刪除後 |
| --- | --- | --- |
| `map` | `MapView` | 保留 |
| `listing-card` | `ListingCard` | 保留 |
| `weight-panel` | `WeightPanel` | 保留（移進浮動面板內） |
| `district-strip` | `DistrictStrip` | 保留 |
| `composer-input` / `composer-submit` | `components/Chat/Composer` | **隨刪除消失** |
| `chat-messages` | `components/Chat/ChatPanel` | **隨刪除消失** |
| `hard-constraints` | `components/HardConstraints` | **隨刪除消失** |

`AgentApp` 自己的輸入框與訊息串目前沒有任何 testid。需新增：
`entrance`、`composer-input`、`composer-submit`、`chat-messages`、
`listing-list`、`listing-list-toggle`、`weight-trigger`、`map-card`。

必測項目：

1. 入口顯示，輸入框與例句 chip 可用
2. 送出後地圖出現、物件欄有卡片
3. **送出後輸入框仍存在**（證明入口沒被重新掛載）
4. 點「修改權重」開面板，七條 slider 全部回 50，關閉後消失
5. 拖動 slider 改變結果順序
6. 物件欄收納後只剩窄軌，展開後卡片回來
7. **點地圖圖示後把滑鼠移開，卡片仍在**（唯一能抓到「常駐失效」的測試）
8. 手機版分頁切換

單元測試：刪除 `lib/agent/` 移除 21 個單元測試與 4 個整合測試。`lib/scoring`、`lib/profile`、`lib/client`、`lib/db`、`lib/geo` 全數保留不動。

## 9. 不在範圍內

- Fastify 後端本身的任何改動
- 排序邏輯（`lib/scoring/` 完全不動）
- 行政區選擇機制（`DistrictStrip` 沿用）
- 真實物件資料（仍為種子資料）
