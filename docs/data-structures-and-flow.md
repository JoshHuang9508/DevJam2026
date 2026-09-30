# 資料結構與資料流

此文件描述目前實作。前端是純展示層；資料抓取、AI 萃取、地址定位、外部補充、embedding、篩選與評分全部在後端。

## 物件資料模型

`listings` 的唯一業務核心欄位是 `address`。其他房屋資訊全部存於 `facts`，不再有 `details`、`features` 或價格、坪數、樓層等固定資料庫欄位。

### listings

| 欄位 | 用途 |
| --- | --- |
| `id` | 系統物件 ID，格式為 `{source}:{sourceId}` |
| `source` | 原始資料來源 ID |
| `source_id` | 來源內的物件 ID |
| `url` | 原始物件網址 |
| `scraped_at` | 抓取時間 |
| `address` | 唯一固定的物件內容欄位 |
| `lat`, `lng` | 後端地址定位結果 |
| `geocode_source` | 座標來源 |
| `geocode_precision` | `exact`、`approximate` 或 `unknown` |
| `geocode_matched_address` | 地址服務回傳的匹配地址 |
| `facts` | 所有固定概念與動態資訊 |
| `semantic_text` | 地址與 facts 組成的 embedding 原文 |
| `embedding` | pgvector 向量 |
| `embedding_model` | embedding 模型 |
| `extraction_model` | AI 萃取模型 |
| `content_hash`, `source_hash` | 變更偵測 |
| `ingest_run_id` | 本次匯入工作 ID |
| `indexed_at` | 最近索引時間 |
| `search_document` | PostgreSQL 全文搜尋欄位 |

`id`、來源、網址、座標、模型、hash 與時間屬於系統追蹤及索引 metadata，不是房屋內容欄位。

### Fact

```ts
type ListingFact = {
  key: string
  label: string
  group: string
  value: unknown
  displayValue: string
  unit?: string
  sourceName?: string
  sourceUrl?: string
  observedAt?: string
  confidence?: number
  evidence?: string
  enrichmentSourceId?: string
}
```

`key` 是穩定的機器名稱，`value` 保留可比較的型別，`displayValue` 由後端產生並供前端直接顯示。可搜尋的已知概念使用下列 key；它們仍然只是 facts，不是資料表欄位：

| key | value 型別 | 意義 |
| --- | --- | --- |
| `listingName` | string | 物件名稱 |
| `description` | string | 描述 |
| `transactionMode` | `sale` 或 `rent` | 交易類型 |
| `city`, `district` | string | 行政區資訊 |
| `price`, `unitPrice` | number | 價格 |
| `area` | number | 坪數 |
| `layout` | string | 格局文字 |
| `rooms` | number | 房數 |
| `floor`, `totalFloor` | number | 樓層 |
| `age` | number | 屋齡 |
| `buildingType` | string | 建物類型 |
| `hasElevator`, `hasParking` | boolean | 設備 |

AI 與 enrichment 可以新增任意穩定的 lower camel case key，例如 `naturalLight`、`annualRainfallMm`、`floodRisk`、`distToMetro`。不要求每個物件都有相同 facts。

## Pipeline 輸入與正規化輸出

資料來源設定由 `raw_sources` 保存。來源可以是 HTML、JSON、CSV 或文字，並可使用單頁、連結清單或 JSON 模式。

AI normalizer 的輸出只有：

```ts
type NormalizedListing = {
  sourceId?: string
  url?: string
  address?: string
  facts: ListingFact[]
}
```

後端會補上來源 metadata、抓取時間、地址拆出的 `city` 與 `district`、來源預設的 `transactionMode`，接著地址轉座標並寫入資料庫。

## 搜尋 API 回傳

`POST /listings/search` 的每筆結果：

```ts
type SearchResult = {
  id: string
  source: { id: string; itemId: string; url: string }
  location: { address: string; lat: number; lng: number }
  facts: ListingFact[]
  assessment: {
    score: number
    starsText: string
    confidence: number
    summary: string
    strengths: string[]
    tradeoffs: string[]
    matchedFactKeys: string[]
    missingInformation: string[]
  }
  view: {
    title: string
    rankLabel: string
    locationLabel: string
    cardFacts: Array<{ key: string; label: string; value: string; wide: boolean }>
    detailFacts: Array<{ key: string; label: string; value: string; wide: boolean; group: string }>
    marker: { label: string; title: string; color: string; size: number; zIndex: number }
    action: { label: string; url: string } | null
  }
}
```

`assessment` 是 AI 依本次使用者需求讀取所有候選 facts 後產生的暫時評估，不寫回物件主檔。`view` 完全由後端組裝，前端直接渲染。

## 完整資料流

```text
raw_sources 定時觸發
→ 抓取原始 HTML / JSON / CSV / text
→ raw_documents 保存原文與 hash
→ AI 辨識每個物件
→ 萃取 address 與任意 facts
→ 後端補來源 metadata 與可推導的 facts
→ Nominatim / reference fallback 地址轉座標
→ 寫入 listings
→ 依 enrichment_sources 查外部資料
→ AI 將外部回應轉為新 facts
→ 重建 semantic_text 與 embedding
→ 使用者輸入
→ facts SQL 必要條件篩選
→ pgvector 語意召回
→ AI 綜合需求與候選物件全部 facts 評分
→ 後端產生 assessment 與 view
→ 前端直接展示
```

## 前後端責任

### 後端

- 管理與排程原始資料來源
- 保存原始文件與處理狀態
- AI 萃取地址與 facts
- 地址轉座標與快取
- 外部資料補充
- embedding、SQL facts 篩選、向量召回與 AI 評估
- 產生所有 UI 顯示字串與排序

### 前端

- 傳送使用者輸入
- 保存必要的互動狀態
- 直接渲染 API 的 `view`、`assessment`、`location` 與 `source`

前端不再包含爬蟲、seed、地址轉座標、欄位合併、評分或顯示值格式化流程。
