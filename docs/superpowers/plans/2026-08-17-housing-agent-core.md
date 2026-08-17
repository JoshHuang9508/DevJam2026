# 台灣選址房仲 Agent — 核心 App 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建出可完整演示的選址網站 — 使用者用中文描述需求，agent 萃取權重，地圖顯示候選物件，權重面板可手動調整並即時重排。

**Architecture:** Next.js 15 全端單體。Gemini 只負責「自然語言 → SearchProfile 變動量」與「結果 → 人話解釋」；排序由 `lib/scoring` 的純函式完成，可單元測試、毫秒回應、權重面板拖動時不呼叫 LLM。所有物件特徵在資料層預先算好，線上查詢零外部 API。

**Tech Stack:** Next.js (App Router) / React 19 / TypeScript strict / Tailwind CSS v4 / MapLibre GL JS / SQLite + Drizzle ORM / `@google/genai` / Zod / Vitest / Playwright / pnpm

**實際解析到的版本**（Task 1 安裝，`next build` 與 `tsc` 皆通過）：`next@16.3.1`、`typescript@7.0.2`、
`react@19.2.8`、`zod@4.4.3`、`drizzle-orm@0.45.2`、`vitest@4.1.10`、`maplibre-gl@6.3.0`、
`@google/genai@2.17.1`、`better-sqlite3@13.0.3`。本計畫的程式碼是對著較早的主版本寫的，
因此 Task 5（maplibre-gl v6）與 Task 7（`@google/genai` v2）的實作者**必須先讀 `node_modules`
裡該套件的實際型別定義**再抄寫，API 有搬動就調整呼叫端並在報告中列為 concern；行為不得改變。

**Spec:** `docs/superpowers/specs/2026-08-17-taiwan-housing-agent-design.md`

**本計畫範圍：** spec 第 11 節的階段 1–4 與 6。使用**種子資料**（台北市 + 新北市，程式產生、確定性）。真實抓取與 enrich pipeline（階段 5）另立計畫 B。

## Global Constraints

- Node.js 20+，套件管理器一律 `pnpm`
- TypeScript `strict: true`，不得使用 `any` 規避型別錯誤
- `GEMINI_API_KEY` 只能在 Route Handler（server 端）讀取；任何 `'use client'` 檔案不得引用
- Gemini model ID 由 `GEMINI_MODEL` 指定，預設 `gemini-3.7-flash`。**禁止**使用 `gemini-2.5-flash`（2026-10-16 停用）
- 七個權重維度的鍵固定為：`price` `value` `weather` `location` `amenities` `space` `quality`
  （`price` = 跨區絕對價格水準，`value` = 同區性價比。Task 4B 前只有六個，缺 `value`）
- 種子資料必須是**確定性**的（固定 seed 的 LCG，不得用 `Math.random()`），否則測試無法重現
- 所有面向使用者的文字為繁體中文
- 每個 task 結束時 `pnpm test` 必須全綠才可 commit

**與 spec §3.3 的目錄差異**（實作時以本計畫為準）：spec 只列了主要目錄，本計畫另外拆出
`lib/profile/`（profile 合併與 Zod 驗證，被 agent 與 API 共用）、`lib/client/`（純前端工具，
不得 import server-only 模組）、`hooks/`、`lib/geo.ts`、`lib/sse.ts`、`lib/test-utils/`。
拆分理由是這些單元被多處共用且需獨立測試。

---

### Task 1: 專案骨架、型別、資料庫與種子資料

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `drizzle.config.ts`, `.gitignore`, `.env.example`
- Create: `app/layout.tsx`, `app/globals.css`, `app/page.tsx`
- Create: `lib/types/profile.ts`, `lib/types/listing.ts`
- Create: `lib/db/schema.ts`, `lib/db/client.ts`
- Create: `lib/geo.ts`
- Create: `scripts/seed.ts`
- Test: `lib/geo.test.ts`

**Interfaces:**
- Consumes: 無（第一個 task）
- Produces:
  - `lib/types/profile.ts`：`Mode`、`WeightKey`、`WEIGHT_KEYS`、`HardConstraints`、`SoftPrefs`、`SearchProfile`、`DEFAULT_PROFILE`
  - `lib/types/listing.ts`：`Listing`、`ListingFeatures`、`ListingWithFeatures`、`DimensionBreakdown`、`ScoredListing`、`RankResult`
  - `lib/geo.ts`：`haversineMeters(aLat,aLng,bLat,bLng): number`、`estimateCommuteMinutes(fromLat,fromLng,toLat,toLng,nearRail): number`
  - `lib/db/client.ts`：`getDb()`、`loadPool(mode: Mode, cities?: string[]): ListingWithFeatures[]`

- [ ] **Step 1: 建立 package.json 與安裝相依套件**

```bash
cd /Users/huangchenhao/Documents/DevJam2026
cat > package.json <<'EOF'
{
  "name": "housing-agent",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:push": "drizzle-kit push",
    "db:seed": "tsx scripts/seed.ts",
    "e2e": "playwright test"
  }
}
EOF
pnpm add next react react-dom drizzle-orm better-sqlite3 zod @google/genai maplibre-gl \
  @radix-ui/react-slider server-only
pnpm add -D typescript @types/node @types/react @types/react-dom @types/better-sqlite3 \
  tailwindcss @tailwindcss/postcss postcss drizzle-kit tsx vitest @playwright/test
```

pnpm 10 起預設封鎖依賴的安裝腳本，`better-sqlite3` 的原生模組會因此建不起來，
後續每個 task 都會在 `loadPool` 掛掉。用 repo 內的 `pnpm-workspace.yaml` 開白名單 ——
**不可**改用全域設定或 `dangerouslyAllowAllBuilds`，那會對整台機器關掉供應鏈防護。

`pnpm-workspace.yaml`:
```yaml
allowBuilds:
  '@google/genai': true
  better-sqlite3: true
  esbuild: true
  protobufjs: true
```

`allowBuilds` 是 pnpm 11 的設定名（map 形式，值為 boolean）。
`onlyBuiltDependencies`、`neverBuiltDependencies` 等舊鍵在 v11 已移除，寫了不會生效也不會報錯。

- [ ] **Step 2: 建立設定檔**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts`:
```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
}

export default nextConfig
```

`postcss.config.mjs`:
```js
export default { plugins: { '@tailwindcss/postcss': {} } }
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd()),
      // server-only 在 Next 的 server bundle 外會直接拋錯，
      // 換成空模組才能對 lib/db/client.ts 寫測試
      'server-only': path.resolve(process.cwd(), 'lib/test-utils/server-only-stub.ts'),
    },
  },
})
```

`drizzle.config.ts`:
```ts
import type { Config } from 'drizzle-kit'

export default {
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: './data/app.db' },
} satisfies Config
```

`.gitignore`（`.superpowers/` 已存在於 repo，必須保留）:
```
node_modules/
.next/
next-env.d.ts
*.tsbuildinfo
data/*.db
data/cache/
.env.local
test-results/
playwright-report/
.superpowers/
```

`.env.example`:
```
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.7-flash
```

- [ ] **Step 3: 建立 App Router 骨架**

`app/globals.css`:
```css
@import "tailwindcss";
@import "maplibre-gl/dist/maplibre-gl.css";

:root { color-scheme: light; }
html, body { height: 100%; }
body { @apply bg-neutral-50 text-neutral-900 antialiased; }
```

`app/layout.tsx`:
```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '安家 — 台灣選址助手',
  description: '用一句話描述你想要的生活，找到適合落腳的地方',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body className="h-full">{children}</body>
    </html>
  )
}
```

`app/page.tsx`（暫時佔位，Task 10 replace）:
```tsx
export default function Home() {
  return <main className="p-8 text-lg">安家 — 建置中</main>
}
```

- [ ] **Step 4: 定義 SearchProfile 型別**

`lib/types/profile.ts`:
```ts
export type Mode = 'sale' | 'rent'

export type WeightKey =
  | 'price'
  | 'weather'
  | 'location'
  | 'amenities'
  | 'space'
  | 'quality'

export const WEIGHT_KEYS: readonly WeightKey[] = [
  'price', 'weather', 'location', 'amenities', 'space', 'quality',
] as const

export const WEIGHT_LABELS: Record<WeightKey, string> = {
  price: '房屋價位',
  weather: '天氣環境',
  location: '地理位置',
  amenities: '生活機能',
  space: '坪數格局',
  quality: '屋況條件',
}

export interface HardConstraints {
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

export interface CommuteAnchor {
  lat: number
  lng: number
  label: string
  maxMin?: number
}

export interface SoftPrefs {
  prefersCool?: boolean
  prefersLowRain?: boolean
  prefersQuiet?: number
  commuteAnchor?: CommuteAnchor
}

export interface SearchProfile {
  mode: Mode
  weights: Record<WeightKey, number>
  hard: HardConstraints
  soft: SoftPrefs
  notes: string[]
}

export const DEFAULT_PROFILE: SearchProfile = {
  mode: 'sale',
  weights: { price: 50, weather: 50, location: 50, amenities: 50, space: 50, quality: 50 },
  hard: {},
  soft: {},
  notes: [],
}
```

- [ ] **Step 5: 定義 Listing 型別**

`lib/types/listing.ts`:
```ts
import type { Mode, WeightKey } from './profile'

export interface Listing {
  id: string
  source: string
  sourceId: string
  mode: Mode
  url: string
  title: string
  scrapedAt: number
  city: string
  district: string
  address: string
  lat: number
  lng: number
  /** sale: 萬元總價 / rent: 元月租 */
  price: number
  /** sale: 萬元每坪 / rent: 元每坪 */
  unitPrice: number
  area: number
  layout: string
  rooms: number
  floor: number
  totalFloor: number
  age: number
  buildingType: string
  hasElevator: boolean
  hasParking: boolean
}

export interface ListingFeatures {
  annualTemp: number | null
  summerTemp: number | null
  winterTemp: number | null
  rainDays: number | null
  humidity: number | null
  sunHours: number | null
  aqiMean: number | null

  poiConvenience500: number | null
  poiConvenience1k: number | null
  poiSupermarket500: number | null
  poiSupermarket1k: number | null
  poiSchool500: number | null
  poiSchool1k: number | null
  poiHospital500: number | null
  poiHospital1k: number | null
  poiPark500: number | null
  poiPark1k: number | null
  poiRestaurant500: number | null
  poiRestaurant1k: number | null

  distToMetro: number | null
  distToTrain: number | null
  distToBus: number | null
  commuteToCbdMin: number | null

  districtMedianUnitPrice: number | null
  /** 0..1，同 city+district+buildingType+mode 內的單價百分位 */
  pricePercentile: number | null

  distToMainRoad: number | null
  distToRail: number | null
}

export type FeatureKey = keyof ListingFeatures

export interface ListingWithFeatures extends Listing {
  features: ListingFeatures
}

export interface DimensionBreakdown {
  subscore: number
  weight: number
  contribution: number
}

export interface ScoredListing extends ListingWithFeatures {
  score: number
  breakdown: Record<WeightKey, DimensionBreakdown>
  dataGaps: string[]
}

export interface RankResult {
  results: ScoredListing[]
  /** 為了避免 0 筆而放寬的條件說明，供 agent 明確告知使用者 */
  relaxations: string[]
}
```

- [ ] **Step 6: 寫 geo 的失敗測試**

`lib/geo.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { estimateCommuteMinutes, haversineMeters } from './geo'

const TAIPEI_STATION = { lat: 25.0478, lng: 121.5170 }
const BANQIAO_STATION = { lat: 25.0143, lng: 121.4637 }

describe('haversineMeters', () => {
  it('同一點距離為 0', () => {
    expect(haversineMeters(25, 121, 25, 121)).toBe(0)
  })

  it('台北車站到板橋車站約 7 公里', () => {
    const d = haversineMeters(
      TAIPEI_STATION.lat, TAIPEI_STATION.lng,
      BANQIAO_STATION.lat, BANQIAO_STATION.lng,
    )
    expect(d).toBeGreaterThan(6000)
    expect(d).toBeLessThan(8000)
  })

  it('對稱', () => {
    const ab = haversineMeters(25.03, 121.52, 25.06, 121.60)
    const ba = haversineMeters(25.06, 121.60, 25.03, 121.52)
    expect(ab).toBeCloseTo(ba, 6)
  })
})

describe('estimateCommuteMinutes', () => {
  it('鄰近軌道站比不鄰近快', () => {
    const near = estimateCommuteMinutes(25.06, 121.60, TAIPEI_STATION.lat, TAIPEI_STATION.lng, true)
    const far = estimateCommuteMinutes(25.06, 121.60, TAIPEI_STATION.lat, TAIPEI_STATION.lng, false)
    expect(near).toBeLessThan(far)
  })

  it('距離越遠時間越長', () => {
    const close = estimateCommuteMinutes(25.05, 121.52, TAIPEI_STATION.lat, TAIPEI_STATION.lng, true)
    const distant = estimateCommuteMinutes(25.13, 121.50, TAIPEI_STATION.lat, TAIPEI_STATION.lng, true)
    expect(distant).toBeGreaterThan(close)
  })

  it('同一點仍有轉乘與步行的基本耗時，不為 0', () => {
    const m = estimateCommuteMinutes(25.0478, 121.5170, TAIPEI_STATION.lat, TAIPEI_STATION.lng, true)
    expect(m).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 7: 執行測試確認失敗**

Run: `pnpm test lib/geo.test.ts`
Expected: FAIL — `Failed to resolve import "./geo"`

- [ ] **Step 8: 實作 lib/geo.ts**

```ts
const EARTH_RADIUS_M = 6_371_000

const toRad = (deg: number): number => (deg * Math.PI) / 180

export function haversineMeters(
  aLat: number, aLng: number, bLat: number, bLng: number,
): number {
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 鄰近軌道站的平均通勤速度 (km/h) */
const SPEED_NEAR_RAIL_KMH = 22
/** 不鄰近軌道站（公車／步行為主）的平均速度 (km/h) */
const SPEED_OFF_RAIL_KMH = 14
/** 進出站、等車、轉乘的固定耗時 (分鐘) */
const TRANSFER_PENALTY_NEAR_RAIL_MIN = 8
const TRANSFER_PENALTY_OFF_RAIL_MIN = 12

/**
 * 估計通勤時間。刻意不做真實路徑規劃 —
 * 直線距離 / 平均速度 + 固定轉乘懲罰，僅供相對排序，UI 須標示為「估計」。
 */
export function estimateCommuteMinutes(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
  nearRail: boolean,
): number {
  const km = haversineMeters(fromLat, fromLng, toLat, toLng) / 1000
  const speed = nearRail ? SPEED_NEAR_RAIL_KMH : SPEED_OFF_RAIL_KMH
  const penalty = nearRail ? TRANSFER_PENALTY_NEAR_RAIL_MIN : TRANSFER_PENALTY_OFF_RAIL_MIN
  return (km / speed) * 60 + penalty
}
```

- [ ] **Step 9: 執行測試確認通過**

Run: `pnpm test lib/geo.test.ts`
Expected: PASS（4 個測試）

- [ ] **Step 10: 定義 Drizzle schema**

`lib/db/schema.ts`:
```ts
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const listings = sqliteTable('listings', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  sourceId: text('source_id').notNull(),
  mode: text('mode', { enum: ['sale', 'rent'] }).notNull(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  scrapedAt: integer('scraped_at').notNull(),
  city: text('city').notNull(),
  district: text('district').notNull(),
  address: text('address').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  price: real('price').notNull(),
  unitPrice: real('unit_price').notNull(),
  area: real('area').notNull(),
  layout: text('layout').notNull(),
  rooms: integer('rooms').notNull(),
  floor: integer('floor').notNull(),
  totalFloor: integer('total_floor').notNull(),
  age: real('age').notNull(),
  buildingType: text('building_type').notNull(),
  hasElevator: integer('has_elevator', { mode: 'boolean' }).notNull(),
  hasParking: integer('has_parking', { mode: 'boolean' }).notNull(),
}, (t) => [
  index('idx_listings_mode_city').on(t.mode, t.city),
  index('idx_listings_district').on(t.district),
])

export const listingFeatures = sqliteTable('listing_features', {
  listingId: text('listing_id').primaryKey().references(() => listings.id),

  annualTemp: real('annual_temp'),
  summerTemp: real('summer_temp'),
  winterTemp: real('winter_temp'),
  rainDays: real('rain_days'),
  humidity: real('humidity'),
  sunHours: real('sun_hours'),
  aqiMean: real('aqi_mean'),

  poiConvenience500: integer('poi_convenience_500'),
  poiConvenience1k: integer('poi_convenience_1k'),
  poiSupermarket500: integer('poi_supermarket_500'),
  poiSupermarket1k: integer('poi_supermarket_1k'),
  poiSchool500: integer('poi_school_500'),
  poiSchool1k: integer('poi_school_1k'),
  poiHospital500: integer('poi_hospital_500'),
  poiHospital1k: integer('poi_hospital_1k'),
  poiPark500: integer('poi_park_500'),
  poiPark1k: integer('poi_park_1k'),
  poiRestaurant500: integer('poi_restaurant_500'),
  poiRestaurant1k: integer('poi_restaurant_1k'),

  distToMetro: real('dist_to_metro'),
  distToTrain: real('dist_to_train'),
  distToBus: real('dist_to_bus'),
  commuteToCbdMin: real('commute_to_cbd_min'),

  districtMedianUnitPrice: real('district_median_unit_price'),
  pricePercentile: real('price_percentile'),

  distToMainRoad: real('dist_to_main_road'),
  distToRail: real('dist_to_rail'),
})

export const districts = sqliteTable('districts', {
  id: text('id').primaryKey(),
  city: text('city').notNull(),
  name: text('name').notNull(),
  centroidLat: real('centroid_lat').notNull(),
  centroidLng: real('centroid_lng').notNull(),
  /** GeoJSON Polygon 字串，choropleth 用；種子階段可為 null */
  boundary: text('boundary'),
})
```

- [ ] **Step 11: 實作 DB client 與 pool 載入**

`lib/db/client.ts`:
```ts
import 'server-only'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { and, eq, inArray } from 'drizzle-orm'
import * as schema from './schema'
import type { Mode } from '@/lib/types/profile'
import type { ListingFeatures, ListingWithFeatures } from '@/lib/types/listing'

const DB_PATH = process.env.DATABASE_PATH ?? './data/app.db'

let cached: ReturnType<typeof drizzle> | null = null

export function getDb() {
  if (!cached) {
    // 唯讀連線不得設定 journal_mode —— 那是寫入操作，會拋
    // SqliteError: attempt to write a readonly database。讀取端沿用寫入端建立的模式即可。
    const sqlite = new Database(DB_PATH, { readonly: true, fileMustExist: true })
    cached = drizzle(sqlite, { schema })
  }
  return cached
}

/**
 * 載入候選池。種子資料規模（數百筆）直接全載；
 * 計畫 B 擴到六都真實資料時，此處改為以 city 分批並加上 LIMIT。
 */
export function loadPool(mode: Mode, cities?: string[]): ListingWithFeatures[] {
  const db = getDb()
  const where = cities?.length
    ? and(eq(schema.listings.mode, mode), inArray(schema.listings.city, cities))
    : eq(schema.listings.mode, mode)

  const rows = db
    .select()
    .from(schema.listings)
    .innerJoin(
      schema.listingFeatures,
      eq(schema.listings.id, schema.listingFeatures.listingId),
    )
    .where(where)
    .all()

  return rows.map((r) => {
    const { listingId: _ignored, ...features } = r.listing_features
    return { ...r.listings, features: features as ListingFeatures }
  })
}
```

- [ ] **Step 12: 寫種子資料產生器**

`scripts/seed.ts`:
```ts
/**
 * 產生確定性的示範資料（台北市 + 新北市）。
 * 氣候值取自中央氣象署測站氣候平均的近似值，POI 與距離為模擬值。
 * 真實抓取與 enrich 見計畫 B。
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { estimateCommuteMinutes, haversineMeters } from '../lib/geo'

/** 確定性亂數：線性同餘產生器。不得改用 Math.random()，否則測試無法重現。 */
function makeRng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

const TAIPEI_STATION = { lat: 25.0478, lng: 121.5170 }

interface DistrictSeed {
  city: string
  name: string
  lat: number
  lng: number
  /** 買賣單價 萬元/坪 */
  saleUnit: number
  /** 租金 元/坪/月 */
  rentUnit: number
  summerTemp: number
  winterTemp: number
  rainDays: number
  humidity: number
  aqi: number
  /** 生活機能豐富度 0..1，影響 POI 模擬值 */
  urbanity: number
  hasMetro: boolean
}

const DISTRICTS: DistrictSeed[] = [
  { city: '臺北市', name: '中正區', lat: 25.0324, lng: 121.5199, saleUnit: 90, rentUnit: 1350, summerTemp: 29.9, winterTemp: 16.6, rainDays: 166, humidity: 74, aqi: 42, urbanity: 0.95, hasMetro: true },
  { city: '臺北市', name: '大同區', lat: 25.0632, lng: 121.5130, saleUnit: 75, rentUnit: 1180, summerTemp: 29.9, winterTemp: 16.6, rainDays: 166, humidity: 75, aqi: 44, urbanity: 0.88, hasMetro: true },
  { city: '臺北市', name: '中山區', lat: 25.0685, lng: 121.5265, saleUnit: 88, rentUnit: 1320, summerTemp: 29.8, winterTemp: 16.7, rainDays: 165, humidity: 74, aqi: 43, urbanity: 0.94, hasMetro: true },
  { city: '臺北市', name: '松山區', lat: 25.0600, lng: 121.5570, saleUnit: 95, rentUnit: 1300, summerTemp: 29.8, winterTemp: 16.8, rainDays: 164, humidity: 74, aqi: 41, urbanity: 0.92, hasMetro: true },
  { city: '臺北市', name: '大安區', lat: 25.0263, lng: 121.5436, saleUnit: 110, rentUnit: 1450, summerTemp: 29.7, winterTemp: 16.8, rainDays: 165, humidity: 74, aqi: 40, urbanity: 0.97, hasMetro: true },
  { city: '臺北市', name: '萬華區', lat: 25.0286, lng: 121.4997, saleUnit: 65, rentUnit: 1050, summerTemp: 30.0, winterTemp: 16.7, rainDays: 166, humidity: 75, aqi: 45, urbanity: 0.85, hasMetro: true },
  { city: '臺北市', name: '信義區', lat: 25.0330, lng: 121.5654, saleUnit: 105, rentUnit: 1420, summerTemp: 29.7, winterTemp: 16.9, rainDays: 166, humidity: 74, aqi: 40, urbanity: 0.96, hasMetro: true },
  { city: '臺北市', name: '士林區', lat: 25.0928, lng: 121.5240, saleUnit: 75, rentUnit: 1120, summerTemp: 29.4, winterTemp: 16.3, rainDays: 172, humidity: 77, aqi: 38, urbanity: 0.78, hasMetro: true },
  { city: '臺北市', name: '北投區', lat: 25.1320, lng: 121.5017, saleUnit: 60, rentUnit: 980, summerTemp: 29.0, winterTemp: 15.9, rainDays: 178, humidity: 79, aqi: 35, urbanity: 0.70, hasMetro: true },
  { city: '臺北市', name: '內湖區', lat: 25.0697, lng: 121.5945, saleUnit: 72, rentUnit: 1100, summerTemp: 29.6, winterTemp: 16.5, rainDays: 170, humidity: 76, aqi: 39, urbanity: 0.80, hasMetro: true },
  { city: '臺北市', name: '南港區', lat: 25.0553, lng: 121.6069, saleUnit: 78, rentUnit: 1080, summerTemp: 29.6, winterTemp: 16.5, rainDays: 172, humidity: 76, aqi: 40, urbanity: 0.75, hasMetro: true },
  { city: '臺北市', name: '文山區', lat: 24.9887, lng: 121.5705, saleUnit: 62, rentUnit: 980, summerTemp: 29.2, winterTemp: 16.1, rainDays: 180, humidity: 79, aqi: 34, urbanity: 0.72, hasMetro: true },
  { city: '新北市', name: '板橋區', lat: 25.0096, lng: 121.4595, saleUnit: 55, rentUnit: 900, summerTemp: 30.1, winterTemp: 16.5, rainDays: 160, humidity: 75, aqi: 47, urbanity: 0.90, hasMetro: true },
  { city: '新北市', name: '新莊區', lat: 25.0359, lng: 121.4506, saleUnit: 45, rentUnit: 820, summerTemp: 30.2, winterTemp: 16.4, rainDays: 158, humidity: 75, aqi: 49, urbanity: 0.82, hasMetro: true },
  { city: '新北市', name: '中和區', lat: 25.0000, lng: 121.4990, saleUnit: 48, rentUnit: 850, summerTemp: 30.0, winterTemp: 16.5, rainDays: 162, humidity: 76, aqi: 46, urbanity: 0.84, hasMetro: true },
  { city: '新北市', name: '永和區', lat: 25.0079, lng: 121.5150, saleUnit: 55, rentUnit: 900, summerTemp: 30.0, winterTemp: 16.6, rainDays: 162, humidity: 75, aqi: 45, urbanity: 0.88, hasMetro: true },
  { city: '新北市', name: '三重區', lat: 25.0616, lng: 121.4874, saleUnit: 45, rentUnit: 830, summerTemp: 30.1, winterTemp: 16.5, rainDays: 160, humidity: 75, aqi: 48, urbanity: 0.83, hasMetro: true },
  { city: '新北市', name: '新店區', lat: 24.9679, lng: 121.5416, saleUnit: 50, rentUnit: 860, summerTemp: 29.3, winterTemp: 16.0, rainDays: 178, humidity: 79, aqi: 35, urbanity: 0.70, hasMetro: true },
  { city: '新北市', name: '土城區', lat: 24.9724, lng: 121.4436, saleUnit: 38, rentUnit: 760, summerTemp: 29.9, winterTemp: 16.2, rainDays: 168, humidity: 77, aqi: 44, urbanity: 0.65, hasMetro: true },
  { city: '新北市', name: '汐止區', lat: 25.0653, lng: 121.6420, saleUnit: 38, rentUnit: 750, summerTemp: 29.5, winterTemp: 16.2, rainDays: 186, humidity: 81, aqi: 38, urbanity: 0.60, hasMetro: false },
]

const BUILDING_TYPES = ['電梯大樓', '公寓', '華廈', '透天厝', '套房'] as const

const LISTINGS_PER_DISTRICT_PER_MODE = 9

interface Row {
  id: string; source: string; sourceId: string; mode: 'sale' | 'rent'
  url: string; title: string; scrapedAt: number
  city: string; district: string; address: string; lat: number; lng: number
  price: number; unitPrice: number; area: number; layout: string; rooms: number
  floor: number; totalFloor: number; age: number; buildingType: string
  hasElevator: number; hasParking: number
  f: Record<string, number | null>
}

function build(): Row[] {
  const rng = makeRng(20260817)
  const rows: Row[] = []

  for (const d of DISTRICTS) {
    for (const mode of ['sale', 'rent'] as const) {
      for (let i = 0; i < LISTINGS_PER_DISTRICT_PER_MODE; i++) {
        const jitter = () => (rng() - 0.5) * 0.018
        const lat = d.lat + jitter()
        const lng = d.lng + jitter()

        const buildingType = BUILDING_TYPES[Math.floor(rng() * BUILDING_TYPES.length)]
        const isStudio = buildingType === '套房'
        const rooms = isStudio ? 1 : 1 + Math.floor(rng() * 4)
        const area = isStudio
          ? 8 + rng() * 8
          : (mode === 'sale' ? 18 : 12) + rooms * 6 + rng() * 12
        const age = buildingType === '公寓' ? 25 + rng() * 25 : rng() * 35
        const totalFloor = buildingType === '透天厝' ? 3 + Math.floor(rng() * 2) : 5 + Math.floor(rng() * 15)
        const floor = 1 + Math.floor(rng() * totalFloor)

        const unitMul = 0.8 + rng() * 0.45 - Math.min(age, 40) / 200
        const unitPrice = (mode === 'sale' ? d.saleUnit : d.rentUnit) * unitMul
        const price = mode === 'sale'
          ? Math.round(unitPrice * area)
          : Math.round((unitPrice * area) / 100) * 100

        const distToMetro = d.hasMetro ? 120 + rng() * 1600 : 2200 + rng() * 3000
        const nearRail = distToMetro <= 800
        const commute = estimateCommuteMinutes(lat, lng, TAIPEI_STATION.lat, TAIPEI_STATION.lng, nearRail)
        const u = d.urbanity
        const poi = (base: number, r: number) => Math.round(base * u * (0.6 + rng() * 0.8) * r)

        const id = `seed-${mode}-${d.city}${d.name}-${i}`
        rows.push({
          id,
          source: 'seed',
          sourceId: id,
          mode,
          url: 'https://example.invalid/seed',
          title: `${d.name}${buildingType} ${rooms}房 ${area.toFixed(1)}坪`,
          scrapedAt: 1_755_388_800_000,
          city: d.city,
          district: d.name,
          address: `${d.city}${d.name}示範路${1 + Math.floor(rng() * 300)}號`,
          lat, lng,
          price,
          unitPrice: Number(unitPrice.toFixed(2)),
          area: Number(area.toFixed(1)),
          layout: isStudio ? '開放式套房' : `${rooms}房${Math.min(rooms, 2)}廳${Math.max(1, rooms - 1)}衛`,
          rooms,
          floor,
          totalFloor,
          age: Number(age.toFixed(1)),
          buildingType,
          hasElevator: buildingType === '公寓' ? 0 : 1,
          hasParking: rng() > 0.45 ? 1 : 0,
          f: {
            annual_temp: Number(((d.summerTemp + d.winterTemp) / 2 + 0.4).toFixed(1)),
            summer_temp: d.summerTemp,
            winter_temp: d.winterTemp,
            rain_days: d.rainDays,
            humidity: d.humidity,
            sun_hours: Math.round(1500 - d.rainDays * 2.2),
            aqi_mean: d.aqi,
            poi_convenience_500: poi(6, 1), poi_convenience_1k: poi(6, 3.1),
            poi_supermarket_500: poi(2, 1), poi_supermarket_1k: poi(2, 3.0),
            poi_school_500: poi(2, 1), poi_school_1k: poi(2, 2.8),
            poi_hospital_500: poi(1, 1), poi_hospital_1k: poi(1, 3.2),
            poi_park_500: poi(2, 1), poi_park_1k: poi(2, 2.9),
            poi_restaurant_500: poi(14, 1), poi_restaurant_1k: poi(14, 3.0),
            dist_to_metro: d.hasMetro ? Math.round(distToMetro) : null,
            dist_to_train: Math.round(900 + rng() * 5200),
            dist_to_bus: Math.round(60 + rng() * 500),
            commute_to_cbd_min: Number(commute.toFixed(1)),
            district_median_unit_price: mode === 'sale' ? d.saleUnit : d.rentUnit,
            price_percentile: null, // Step 13 回填
            dist_to_main_road: Math.round(40 + rng() * 700),
            dist_to_rail: Math.round(200 + rng() * 3000),
          },
        })
      }
    }
  }
  return rows
}

/** 同 mode + city + district + buildingType 分組計算單價百分位 */
function fillPercentiles(rows: Row[]): void {
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const key = `${r.mode}|${r.city}|${r.district}|${r.buildingType}`
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => a.unitPrice - b.unitPrice)
    sorted.forEach((r, i) => {
      r.f.price_percentile = sorted.length === 1 ? 0.5 : i / (sorted.length - 1)
    })
  }
}

function main(): void {
  mkdirSync('./data', { recursive: true })
  const db = new Database(process.env.DATABASE_PATH ?? './data/app.db')
  const rows = build()
  fillPercentiles(rows)

  db.exec('DELETE FROM listing_features; DELETE FROM listings; DELETE FROM districts;')

  const insertDistrict = db.prepare(
    `INSERT INTO districts (id, city, name, centroid_lat, centroid_lng, boundary)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  )
  const insertListing = db.prepare(
    `INSERT INTO listings (id, source, source_id, mode, url, title, scraped_at, city, district,
      address, lat, lng, price, unit_price, area, layout, rooms, floor, total_floor, age,
      building_type, has_elevator, has_parking)
     VALUES (@id, @source, @sourceId, @mode, @url, @title, @scrapedAt, @city, @district,
      @address, @lat, @lng, @price, @unitPrice, @area, @layout, @rooms, @floor, @totalFloor,
      @age, @buildingType, @hasElevator, @hasParking)`,
  )

  const featureCols = Object.keys(rows[0].f)
  const insertFeatures = db.prepare(
    `INSERT INTO listing_features (listing_id, ${featureCols.join(', ')})
     VALUES (?, ${featureCols.map(() => '?').join(', ')})`,
  )

  db.transaction(() => {
    for (const d of DISTRICTS) {
      insertDistrict.run(`${d.city}-${d.name}`, d.city, d.name, d.lat, d.lng)
    }
    for (const r of rows) {
      const { f, ...listing } = r
      insertListing.run(listing)
      insertFeatures.run(r.id, ...featureCols.map((c) => f[c]))
    }
  })()

  const count = db.prepare('SELECT COUNT(*) AS n FROM listings').get() as { n: number }
  console.log(`已寫入 ${count.n} 筆物件、${DISTRICTS.length} 個行政區`)
  db.close()
}

main()
```

- [ ] **Step 13: 建表並灌入種子資料**

```bash
mkdir -p data
pnpm db:push
pnpm db:seed
```
Expected: `已寫入 360 筆物件、20 個行政區`

驗證：
```bash
sqlite3 data/app.db "SELECT mode, COUNT(*) FROM listings GROUP BY mode;"
```
Expected: `rent|180` 與 `sale|180`

- [ ] **Step 14: 為 `loadPool` 寫端對端測試**

`getDb()` / `loadPool()` 是九個後續 task 共用的介面，卻是本 task 唯一沒有測試覆蓋的匯出。
補上一個直接打真實種子資料庫的測試。

`lib/test-utils/server-only-stub.ts`:
```ts
// vitest 用的空模組。正式執行時 Next 會解析到真正的 server-only 套件。
export {}
```

`lib/db/client.test.ts`:
```ts
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadPool } from './client'

const DB_PATH = './data/app.db'

describe('loadPool', () => {
  it('資料庫存在（未建立請先跑 pnpm db:push && pnpm db:seed）', () => {
    expect(existsSync(DB_PATH)).toBe(true)
  })

  it('載入買賣物件並附上特徵', () => {
    const pool = loadPool('sale')
    expect(pool).toHaveLength(180)
    expect(pool.every((l) => l.mode === 'sale')).toBe(true)
    const first = pool[0]
    expect(first.features).toBeDefined()
    expect(typeof first.features.summerTemp).toBe('number')
    expect(typeof first.features.pricePercentile).toBe('number')
    // listing_features 的主鍵欄位不應洩漏進 features
    expect(first.features).not.toHaveProperty('listingId')
  })

  it('載入租賃物件', () => {
    expect(loadPool('rent')).toHaveLength(180)
  })

  it('依城市篩選', () => {
    const pool = loadPool('sale', ['臺北市'])
    expect(pool.length).toBeGreaterThan(0)
    expect(pool.every((l) => l.city === '臺北市')).toBe(true)
  })

  it('城市不存在時回空陣列而非拋錯', () => {
    expect(loadPool('sale', ['不存在市'])).toEqual([])
  })
})
```

Run: `pnpm test lib/db/client.test.ts`
Expected: PASS（5 個測試）

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat: 專案骨架、型別、SQLite schema 與確定性種子資料"
```

---

### Task 2: 評分引擎 — 正規化、缺值填補、六維子分數

**Files:**
- Create: `lib/scoring/normalize.ts`, `lib/scoring/gaps.ts`, `lib/scoring/dimensions.ts`
- Test: `lib/scoring/normalize.test.ts`, `lib/scoring/gaps.test.ts`, `lib/scoring/dimensions.test.ts`
- Create: `lib/test-utils/factory.ts`（測試用物件工廠，供本 task 與後續 task 共用）

**Interfaces:**
- Consumes: Task 1 的 `ListingWithFeatures`、`ListingFeatures`、`SearchProfile`、`WeightKey`、`WEIGHT_KEYS`、`lib/geo.ts` 的 `estimateCommuteMinutes`
- Produces:
  - `minMaxNormalize(values: number[]): number[]`
  - `FilledListing { listing: ListingWithFeatures; features: { [K in FeatureKey]: number }; dataGaps: string[] }`
    （`features` 是**剝掉 null 的映射型別**，不是 `ListingFeatures` —— 填補後保證每個欄位都是 number）
  - `fillDataGaps(pool: ListingWithFeatures[]): FilledListing[]`
  - `DIMENSIONS: Record<WeightKey, (f: FilledListing, p: SearchProfile) => number>`（回傳值恆為「越高越好」的原始分數）
  - `makeListing(overrides?): ListingWithFeatures`、`makeFeatures(overrides?): ListingFeatures`

- [ ] **Step 1: 寫測試工廠**

`lib/test-utils/factory.ts`:
```ts
import type { ListingFeatures, ListingWithFeatures } from '@/lib/types/listing'

export function makeFeatures(o: Partial<ListingFeatures> = {}): ListingFeatures {
  return {
    annualTemp: 23.5, summerTemp: 29.5, winterTemp: 16.5,
    rainDays: 165, humidity: 75, sunHours: 1400, aqiMean: 42,
    poiConvenience500: 5, poiConvenience1k: 15,
    poiSupermarket500: 2, poiSupermarket1k: 6,
    poiSchool500: 2, poiSchool1k: 5,
    poiHospital500: 1, poiHospital1k: 3,
    poiPark500: 2, poiPark1k: 5,
    poiRestaurant500: 12, poiRestaurant1k: 40,
    distToMetro: 600, distToTrain: 2000, distToBus: 150, commuteToCbdMin: 25,
    districtMedianUnitPrice: 70, pricePercentile: 0.5,
    distToMainRoad: 300, distToRail: 1200,
    ...o,
  }
}

// features 必須是「深層 partial」——測試都只覆寫其中幾個欄位。
// 直接用 Partial<ListingWithFeatures> 在 strict 下會要求 features 是完整物件。
export type ListingOverride = Partial<Omit<ListingWithFeatures, 'features'>> & {
  features?: Partial<ListingFeatures>
}

export function makeListing(o: ListingOverride = {}): ListingWithFeatures {
  const { features, ...rest } = o
  return {
    id: 'L1', source: 'test', sourceId: 'L1', mode: 'sale',
    url: 'https://example.invalid/1', title: '測試物件', scrapedAt: 0,
    city: '臺北市', district: '大安區', address: '臺北市大安區測試路1號',
    lat: 25.0263, lng: 121.5436,
    price: 2000, unitPrice: 80, area: 25, layout: '2房2廳1衛', rooms: 2,
    floor: 5, totalFloor: 12, age: 10, buildingType: '電梯大樓',
    hasElevator: true, hasParking: true,
    features: makeFeatures(features),
    ...rest,
  }
}
```

- [ ] **Step 2: 寫 normalize 的失敗測試**

`lib/scoring/normalize.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { minMaxNormalize } from './normalize'

describe('minMaxNormalize', () => {
  it('把值線性映射到 0..1', () => {
    expect(minMaxNormalize([0, 5, 10])).toEqual([0, 0.5, 1])
  })

  it('全部相同時一律回 0.5，不得產生 NaN', () => {
    const out = minMaxNormalize([7, 7, 7])
    expect(out).toEqual([0.5, 0.5, 0.5])
    expect(out.some(Number.isNaN)).toBe(false)
  })

  it('單一元素回 0.5', () => {
    expect(minMaxNormalize([42])).toEqual([0.5])
  })

  it('空陣列回空陣列', () => {
    expect(minMaxNormalize([])).toEqual([])
  })

  it('處理負值', () => {
    expect(minMaxNormalize([-10, 0, 10])).toEqual([0, 0.5, 1])
  })
})
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `pnpm test lib/scoring/normalize.test.ts`
Expected: FAIL — `Failed to resolve import "./normalize"`

- [ ] **Step 4: 實作 normalize**

`lib/scoring/normalize.ts`:
```ts
/**
 * 在候選池內做 min-max 正規化。
 * 全部相同或只有一筆時一律回 0.5 — 該維度無鑑別度，不應影響排序。
 */
export function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return []
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const span = max - min
  if (span === 0) return values.map(() => 0.5)
  return values.map((v) => (v - min) / span)
}
```

- [ ] **Step 5: 執行測試確認通過**

Run: `pnpm test lib/scoring/normalize.test.ts`
Expected: PASS（5 個測試）

- [ ] **Step 6: 寫缺值填補的失敗測試**

`lib/scoring/gaps.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { fillDataGaps } from './gaps'
import { makeListing } from '@/lib/test-utils/factory'

describe('fillDataGaps', () => {
  it('用同行政區中位數補 null，並記錄 dataGaps', () => {
    const pool = [
      makeListing({ id: 'A', features: { aqiMean: 30 } }),
      makeListing({ id: 'B', features: { aqiMean: 50 } }),
      makeListing({ id: 'C', features: { aqiMean: null } }),
    ]
    const filled = fillDataGaps(pool)
    const c = filled.find((f) => f.listing.id === 'C')!
    expect(c.features.aqiMean).toBe(40)
    expect(c.dataGaps).toContain('aqiMean')
  })

  it('無缺值時 dataGaps 為空', () => {
    const filled = fillDataGaps([makeListing({ id: 'A' })])
    expect(filled[0].dataGaps).toEqual([])
  })

  it('同區全為 null 時退回全池中位數', () => {
    const pool = [
      makeListing({ id: 'A', district: '大安區', features: { distToMetro: 400 } }),
      makeListing({ id: 'B', district: '大安區', features: { distToMetro: 800 } }),
      makeListing({ id: 'C', district: '汐止區', features: { distToMetro: null } }),
    ]
    const c = fillDataGaps(pool).find((f) => f.listing.id === 'C')!
    expect(c.features.distToMetro).toBe(600)
    expect(c.dataGaps).toContain('distToMetro')
  })

  it('全池皆為 null 時填 0 且仍標記缺值', () => {
    const pool = [makeListing({ id: 'A', features: { sunHours: null } })]
    const a = fillDataGaps(pool)[0]
    expect(a.features.sunHours).toBe(0)
    expect(a.dataGaps).toContain('sunHours')
  })

  it('不改動原始 listing 物件', () => {
    const pool = [makeListing({ id: 'A', features: { aqiMean: null } })]
    fillDataGaps(pool)
    expect(pool[0].features.aqiMean).toBeNull()
  })
})
```

- [ ] **Step 7: 執行測試確認失敗**

Run: `pnpm test lib/scoring/gaps.test.ts`
Expected: FAIL — `Failed to resolve import "./gaps"`

- [ ] **Step 8: 實作缺值填補**

`lib/scoring/gaps.ts`:
```ts
import type { FeatureKey, ListingFeatures, ListingWithFeatures } from '@/lib/types/listing'

export interface FilledListing {
  listing: ListingWithFeatures
  /** 所有 null 已被中位數（或 0）取代 */
  features: { [K in FeatureKey]: number }
  dataGaps: string[]
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * 缺值以「同行政區中位數 → 全池中位數 → 0」的順序填補，
 * 並在 dataGaps 記下欄位名，供 UI 標示「資料不足」。
 */
export function fillDataGaps(pool: ListingWithFeatures[]): FilledListing[] {
  if (pool.length === 0) return []

  const keys = Object.keys(pool[0].features) as FeatureKey[]
  const byDistrict = new Map<string, ListingWithFeatures[]>()
  for (const l of pool) {
    const k = `${l.city}|${l.district}`
    const g = byDistrict.get(k)
    if (g) g.push(l)
    else byDistrict.set(k, [l])
  }

  const globalMedian = new Map<FeatureKey, number | null>()
  const districtMedian = new Map<string, number | null>()
  for (const key of keys) {
    globalMedian.set(key, median(pool.map((l) => l.features[key]).filter((v): v is number => v !== null)))
    for (const [dk, group] of byDistrict) {
      districtMedian.set(
        `${dk}|${key}`,
        median(group.map((l) => l.features[key]).filter((v): v is number => v !== null)),
      )
    }
  }

  return pool.map((listing) => {
    const dataGaps: string[] = []
    const features = {} as { [K in FeatureKey]: number }
    for (const key of keys) {
      const raw = listing.features[key]
      if (raw !== null) {
        features[key] = raw
        continue
      }
      dataGaps.push(key)
      features[key] =
        districtMedian.get(`${listing.city}|${listing.district}|${key}`) ??
        globalMedian.get(key) ??
        0
    }
    return { listing, features, dataGaps }
  })
}

/** 型別輔助：FilledListing 的 features 一定沒有 null */
export type FilledFeatures = FilledListing['features']
```

`gaps.ts` 的 import 只需要 `FeatureKey` 與 `ListingWithFeatures`：
```ts
import type { FeatureKey, ListingWithFeatures } from '@/lib/types/listing'
```

- [ ] **Step 9: 執行測試確認通過**

Run: `pnpm test lib/scoring/gaps.test.ts`
Expected: PASS（5 個測試）

- [ ] **Step 10: 寫六維子分數的失敗測試**

`lib/scoring/dimensions.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { DIMENSIONS } from './dimensions'
import { fillDataGaps } from './gaps'
import { makeListing } from '@/lib/test-utils/factory'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'
import type { ListingWithFeatures } from '@/lib/types/listing'

const fill = (l: ListingWithFeatures) => fillDataGaps([l])[0]
const profile = (o: Partial<SearchProfile> = {}): SearchProfile => ({ ...DEFAULT_PROFILE, ...o })

describe('DIMENSIONS.price', () => {
  it('百分位越低分數越高', () => {
    const cheap = DIMENSIONS.price(fill(makeListing({ features: { pricePercentile: 0.1 } })), profile())
    const pricey = DIMENSIONS.price(fill(makeListing({ features: { pricePercentile: 0.9 } })), profile())
    expect(cheap).toBeGreaterThan(pricey)
  })

  it('有 budgetMax 也不改變公式（單調性不變量）', () => {
    const p = profile({ hard: { budgetMax: 3000 } })
    const cheap = DIMENSIONS.price(fill(makeListing({ features: { pricePercentile: 0.1 } })), p)
    const pricey = DIMENSIONS.price(fill(makeListing({ features: { pricePercentile: 0.9 } })), p)
    expect(cheap).toBeGreaterThan(pricey)
  })
})

describe('DIMENSIONS.weather', () => {
  it('夏天涼、雨少、空品好的分數較高', () => {
    const good = DIMENSIONS.weather(
      fill(makeListing({ features: { summerTemp: 27, rainDays: 120, aqiMean: 25, humidity: 68 } })), profile())
    const bad = DIMENSIONS.weather(
      fill(makeListing({ features: { summerTemp: 33, rainDays: 200, aqiMean: 80, humidity: 85 } })), profile())
    expect(good).toBeGreaterThan(bad)
  })

  it('prefersCool 讓夏季溫度的影響變大', () => {
    const hot = makeListing({ features: { summerTemp: 33 } })
    const cool = makeListing({ features: { summerTemp: 27 } })
    const base = DIMENSIONS.weather(fill(cool), profile()) - DIMENSIONS.weather(fill(hot), profile())
    const p = profile({ soft: { prefersCool: true } })
    const boosted = DIMENSIONS.weather(fill(cool), p) - DIMENSIONS.weather(fill(hot), p)
    expect(boosted).toBeGreaterThan(base)
  })

  it('prefersLowRain 讓降雨日數的影響變大', () => {
    const wet = makeListing({ features: { rainDays: 200 } })
    const dry = makeListing({ features: { rainDays: 120 } })
    const base = DIMENSIONS.weather(fill(dry), profile()) - DIMENSIONS.weather(fill(wet), profile())
    const p = profile({ soft: { prefersLowRain: true } })
    const boosted = DIMENSIONS.weather(fill(dry), p) - DIMENSIONS.weather(fill(wet), p)
    expect(boosted).toBeGreaterThan(base)
  })
})

describe('DIMENSIONS.location', () => {
  it('無通勤錨點時，離捷運越近分數越高', () => {
    const near = DIMENSIONS.location(fill(makeListing({ features: { distToMetro: 200 } })), profile())
    const far = DIMENSIONS.location(fill(makeListing({ features: { distToMetro: 2500 } })), profile())
    expect(near).toBeGreaterThan(far)
  })

  it('有通勤錨點時，離錨點越近分數越高', () => {
    const p = profile({ soft: { commuteAnchor: { lat: 25.0330, lng: 121.5654, label: '信義區', maxMin: 40 } } })
    const near = DIMENSIONS.location(fill(makeListing({ lat: 25.0340, lng: 121.5640 })), p)
    const far = DIMENSIONS.location(fill(makeListing({ lat: 25.1320, lng: 121.5017 })), p)
    expect(near).toBeGreaterThan(far)
  })

  it('通勤超過 maxMin 不會被排除，只是分數低（軟性）', () => {
    const p = profile({ soft: { commuteAnchor: { lat: 25.0330, lng: 121.5654, label: '信義區', maxMin: 5 } } })
    const s = DIMENSIONS.location(fill(makeListing({ lat: 24.9679, lng: 121.5416 })), p)
    expect(s).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(s)).toBe(true)
  })
})

describe('DIMENSIONS.amenities', () => {
  it('POI 越多分數越高', () => {
    const rich = DIMENSIONS.amenities(fill(makeListing({
      features: { poiConvenience500: 12, poiSupermarket500: 5, poiPark500: 4, poiRestaurant500: 40 },
    })), profile())
    const poor = DIMENSIONS.amenities(fill(makeListing({
      features: { poiConvenience500: 1, poiSupermarket500: 0, poiPark500: 0, poiRestaurant500: 2 },
    })), profile())
    expect(rich).toBeGreaterThan(poor)
  })

  it('500m 的權重高於 1km', () => {
    const close = DIMENSIONS.amenities(fill(makeListing({
      features: { poiSupermarket500: 4, poiSupermarket1k: 4 },
    })), profile())
    const spread = DIMENSIONS.amenities(fill(makeListing({
      features: { poiSupermarket500: 0, poiSupermarket1k: 8 },
    })), profile())
    expect(close).toBeGreaterThan(spread)
  })
})

describe('DIMENSIONS.space', () => {
  it('坪數越大分數越高，但邊際遞減', () => {
    const p = profile({ hard: { minArea: 20 } })
    const s20 = DIMENSIONS.space(fill(makeListing({ area: 20 })), p)
    const s40 = DIMENSIONS.space(fill(makeListing({ area: 40 })), p)
    const s80 = DIMENSIONS.space(fill(makeListing({ area: 80 })), p)
    expect(s40).toBeGreaterThan(s20)
    expect(s80 - s40).toBeLessThan(s40 - s20)
  })

  it('房間數不足需求時分數較低', () => {
    const p = profile({ hard: { minRooms: 3 } })
    const enough = DIMENSIONS.space(fill(makeListing({ rooms: 3 })), p)
    const short = DIMENSIONS.space(fill(makeListing({ rooms: 1 })), p)
    expect(enough).toBeGreaterThan(short)
  })
})

describe('DIMENSIONS.quality', () => {
  it('屋齡越新分數越高', () => {
    const fresh = DIMENSIONS.quality(fill(makeListing({ age: 2 })), profile())
    const old = DIMENSIONS.quality(fill(makeListing({ age: 38 })), profile())
    expect(fresh).toBeGreaterThan(old)
  })

  it('一樓與頂樓扣分', () => {
    const mid = DIMENSIONS.quality(fill(makeListing({ floor: 5, totalFloor: 12 })), profile())
    const ground = DIMENSIONS.quality(fill(makeListing({ floor: 1, totalFloor: 12 })), profile())
    const top = DIMENSIONS.quality(fill(makeListing({ floor: 12, totalFloor: 12 })), profile())
    expect(mid).toBeGreaterThan(ground)
    expect(mid).toBeGreaterThan(top)
  })

  it('prefersQuiet 為正時，遠離主幹道加分', () => {
    const p = profile({ soft: { prefersQuiet: 1 } })
    const quiet = DIMENSIONS.quality(fill(makeListing({ features: { distToMainRoad: 500, distToRail: 900 } })), p)
    const noisy = DIMENSIONS.quality(fill(makeListing({ features: { distToMainRoad: 30, distToRail: 60 } })), p)
    expect(quiet).toBeGreaterThan(noisy)
  })

  it('prefersQuiet 未設定時，噪音距離不影響分數', () => {
    const quiet = DIMENSIONS.quality(fill(makeListing({ features: { distToMainRoad: 500, distToRail: 900 } })), profile())
    const noisy = DIMENSIONS.quality(fill(makeListing({ features: { distToMainRoad: 30, distToRail: 60 } })), profile())
    expect(quiet).toBeCloseTo(noisy, 10)
  })
})

describe('DIMENSIONS 完整性', () => {
  it('六個維度都存在且回傳有限數值', () => {
    const f = fill(makeListing())
    for (const key of ['price', 'weather', 'location', 'amenities', 'space', 'quality'] as const) {
      const v = DIMENSIONS[key](f, profile())
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})
```

- [ ] **Step 11: 執行測試確認失敗**

Run: `pnpm test lib/scoring/dimensions.test.ts`
Expected: FAIL — `Failed to resolve import "./dimensions"`

- [ ] **Step 12: 實作六維子分數**

`lib/scoring/dimensions.ts`:
```ts
import { estimateCommuteMinutes } from '@/lib/geo'
import type { SearchProfile, WeightKey } from '@/lib/types/profile'
import type { FilledListing } from './gaps'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export type DimensionFn = (f: FilledListing, p: SearchProfile) => number

/**
 * 房屋價位。恆為 1 - pricePercentile。
 * 刻意不因 budgetMax 改變曲線 — 「貼近預算上限為佳」會破壞
 * 「拉高 price 權重 → 便宜物件排名上升」的單調性不變量。
 * 超出預算已由 hard filter 排除，物件品質由 quality/space 維度把關。
 */
const price: DimensionFn = (f) => 1 - clamp01(f.features.pricePercentile)

/** 舒適溫度區間：夏季 26°C 以下滿分、34°C 0 分；冬季 18°C 以上滿分、8°C 0 分 */
const SUMMER_BEST = 26
const SUMMER_WORST = 34
const WINTER_BEST = 18
const WINTER_WORST = 8
const AQI_WORST = 150

const weather: DimensionFn = (f, p) => {
  const x = f.features
  const summer = 1 - clamp01((x.summerTemp - SUMMER_BEST) / (SUMMER_WORST - SUMMER_BEST))
  const winter = 1 - clamp01((WINTER_BEST - x.winterTemp) / (WINTER_BEST - WINTER_WORST))
  const rain = 1 - clamp01(x.rainDays / 365)
  const humid = 1 - clamp01(x.humidity / 100)
  const air = 1 - clamp01(x.aqiMean / AQI_WORST)

  const w = { summer: 0.25, winter: 0.15, rain: 0.25, humid: 0.15, air: 0.20 }
  if (p.soft.prefersCool) w.summer = 0.45
  if (p.soft.prefersLowRain) w.rain = 0.45
  const total = w.summer + w.winter + w.rain + w.humid + w.air

  return (
    (summer * w.summer + winter * w.winter + rain * w.rain + humid * w.humid + air * w.air) / total
  )
}

/** 步行可及的軌道站距離門檻 (公尺) */
const RAIL_WALKABLE_M = 800
/** 未設定 maxMin 時的通勤時間參考上限 (分鐘) */
const DEFAULT_MAX_COMMUTE_MIN = 60

const location: DimensionFn = (f, p) => {
  const x = f.features
  const anchor = p.soft.commuteAnchor
  if (anchor) {
    const nearRail = Math.min(x.distToMetro, x.distToTrain) <= RAIL_WALKABLE_M
    const mins = estimateCommuteMinutes(f.listing.lat, f.listing.lng, anchor.lat, anchor.lng, nearRail)
    // maxMin 只是軟性轉折點：超過就趨近 0，但物件不會被排除
    return 1 - clamp01(mins / (anchor.maxMin ?? DEFAULT_MAX_COMMUTE_MIN))
  }
  const rail = Math.min(x.distToMetro, x.distToTrain)
  return 1 / (1 + rail / RAIL_WALKABLE_M)
}

const POI_CATEGORY_WEIGHTS = {
  convenience: 0.15,
  supermarket: 0.20,
  park: 0.20,
  hospital: 0.15,
  school: 0.15,
  restaurant: 0.15,
} as const

const NEAR_RING_WEIGHT = 0.65
const WIDE_RING_WEIGHT = 0.35

const amenities: DimensionFn = (f) => {
  const x = f.features
  const pairs: Array<[keyof typeof POI_CATEGORY_WEIGHTS, number, number]> = [
    ['convenience', x.poiConvenience500, x.poiConvenience1k],
    ['supermarket', x.poiSupermarket500, x.poiSupermarket1k],
    ['park', x.poiPark500, x.poiPark1k],
    ['hospital', x.poiHospital500, x.poiHospital1k],
    ['school', x.poiSchool500, x.poiSchool1k],
    ['restaurant', x.poiRestaurant500, x.poiRestaurant1k],
  ]
  let sum = 0
  for (const [cat, near, wide] of pairs) {
    sum += POI_CATEGORY_WEIGHTS[cat] *
      (Math.log1p(Math.max(0, near)) * NEAR_RING_WEIGHT +
        Math.log1p(Math.max(0, wide)) * WIDE_RING_WEIGHT)
  }
  return sum
}

/** 未指定需求時的預設坪數基準 */
const DEFAULT_AREA_NEED = { sale: 25, rent: 12 } as const
const DEFAULT_ROOMS_NEED = 2
/** 達到需求 2 倍時 areaScore 接近 1 */
const AREA_SATURATION = Math.log1p(2)

const space: DimensionFn = (f, p) => {
  const areaNeed = p.hard.minArea ?? DEFAULT_AREA_NEED[p.mode]
  const roomsNeed = p.hard.minRooms ?? DEFAULT_ROOMS_NEED
  const areaScore = clamp01(Math.log1p(f.listing.area / areaNeed) / AREA_SATURATION)
  const roomScore = clamp01(f.listing.rooms / roomsNeed)
  return 0.65 * areaScore + 0.35 * roomScore
}

/** 屋齡 40 年以上視為 0 分 */
const AGE_WORST_YEARS = 40
/** 噪音距離達 300m 視為滿分安靜 */
const QUIET_SATURATION_M = 300

const quality: DimensionFn = (f, p) => {
  const l = f.listing
  const x = f.features
  const ageScore = 1 - clamp01(l.age / AGE_WORST_YEARS)
  const floorScore = l.floor === 1 || l.floor === l.totalFloor ? 0.6 : 1
  const elevatorScore = l.hasElevator ? 1 : 0.7
  const parkingScore = l.hasParking ? 1 : 0.85
  const quietScore = (p.soft.prefersQuiet ?? 0) > 0
    ? clamp01(Math.min(x.distToMainRoad, x.distToRail) / QUIET_SATURATION_M)
    : 1

  return (
    0.35 * ageScore +
    0.15 * floorScore +
    0.15 * elevatorScore +
    0.10 * parkingScore +
    0.25 * quietScore
  )
}

export const DIMENSIONS: Record<WeightKey, DimensionFn> = {
  price, weather, location, amenities, space, quality,
}
```

- [ ] **Step 13: 執行測試確認通過**

Run: `pnpm test`
Expected: PASS（geo 4 + normalize 5 + gaps 5 + dimensions 16 = 30 個測試）

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat(scoring): 正規化、缺值填補與六維子分數"
```

---

### Task 3: 評分引擎 — hard filter、加權排序、多樣性、放寬策略

**Files:**
- Create: `lib/scoring/filter.ts`, `lib/scoring/index.ts`, `lib/scoring/relax.ts`
- Test: `lib/scoring/filter.test.ts`, `lib/scoring/index.test.ts`, `lib/scoring/relax.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `DIMENSIONS`、`fillDataGaps`、`FilledListing`、`minMaxNormalize`；Task 1 的 `SearchProfile`、`WEIGHT_KEYS`、`ScoredListing`、`RankResult`
- Produces:
  - `applyHardFilter(pool: ListingWithFeatures[], p: SearchProfile): ListingWithFeatures[]`
  - `MAX_RESULTS = 30`、`MAX_PER_DISTRICT = 5`
  - `normalizeWeights(w: Record<WeightKey, number>): Record<WeightKey, number>`（總和為 1）
  - `score(profile: SearchProfile, pool: ListingWithFeatures[]): ScoredListing[]`
  - `rankWithRelaxation(profile: SearchProfile, pool: ListingWithFeatures[]): RankResult`

- [ ] **Step 1: 寫 hard filter 的失敗測試**

`lib/scoring/filter.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { applyHardFilter } from './filter'
import { makeListing } from '@/lib/test-utils/factory'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'

const profile = (o: Partial<SearchProfile> = {}): SearchProfile => ({ ...DEFAULT_PROFILE, ...o })

describe('applyHardFilter', () => {
  it('依 mode 篩選', () => {
    const pool = [makeListing({ id: 'S', mode: 'sale' }), makeListing({ id: 'R', mode: 'rent' })]
    expect(applyHardFilter(pool, profile({ mode: 'rent' })).map((l) => l.id)).toEqual(['R'])
  })

  it('依 cities 與 districts 篩選', () => {
    const pool = [
      makeListing({ id: 'A', city: '臺北市', district: '大安區' }),
      makeListing({ id: 'B', city: '臺北市', district: '北投區' }),
      makeListing({ id: 'C', city: '新北市', district: '板橋區' }),
    ]
    expect(applyHardFilter(pool, profile({ hard: { cities: ['臺北市'] } })).map((l) => l.id)).toEqual(['A', 'B'])
    expect(applyHardFilter(pool, profile({ hard: { districts: ['板橋區'] } })).map((l) => l.id)).toEqual(['C'])
  })

  it('依預算上下限篩選', () => {
    const pool = [
      makeListing({ id: 'A', price: 1000 }),
      makeListing({ id: 'B', price: 2000 }),
      makeListing({ id: 'C', price: 3000 }),
    ]
    expect(applyHardFilter(pool, profile({ hard: { budgetMax: 2000 } })).map((l) => l.id)).toEqual(['A', 'B'])
    expect(applyHardFilter(pool, profile({ hard: { budgetMin: 2000 } })).map((l) => l.id)).toEqual(['B', 'C'])
  })

  it('依坪數、房數、屋齡、型態篩選', () => {
    const pool = [
      makeListing({ id: 'A', area: 15, rooms: 1, age: 5, buildingType: '套房' }),
      makeListing({ id: 'B', area: 35, rooms: 3, age: 40, buildingType: '公寓' }),
      makeListing({ id: 'C', area: 30, rooms: 3, age: 8, buildingType: '電梯大樓' }),
    ]
    expect(applyHardFilter(pool, profile({ hard: { minArea: 25 } })).map((l) => l.id)).toEqual(['B', 'C'])
    expect(applyHardFilter(pool, profile({ hard: { minRooms: 3 } })).map((l) => l.id)).toEqual(['B', 'C'])
    expect(applyHardFilter(pool, profile({ hard: { maxAge: 20 } })).map((l) => l.id)).toEqual(['A', 'C'])
    expect(applyHardFilter(pool, profile({ hard: { buildingTypes: ['電梯大樓'] } })).map((l) => l.id)).toEqual(['C'])
  })

  it('依電梯、車位、捷運距離篩選', () => {
    const pool = [
      makeListing({ id: 'A', hasElevator: false, hasParking: false, features: { distToMetro: 300 } }),
      makeListing({ id: 'B', hasElevator: true, hasParking: true, features: { distToMetro: 1500 } }),
    ]
    expect(applyHardFilter(pool, profile({ hard: { needElevator: true } })).map((l) => l.id)).toEqual(['B'])
    expect(applyHardFilter(pool, profile({ hard: { needParking: true } })).map((l) => l.id)).toEqual(['B'])
    expect(applyHardFilter(pool, profile({ hard: { maxDistToMetro: 800 } })).map((l) => l.id)).toEqual(['A'])
  })

  it('distToMetro 為 null 時，maxDistToMetro 不排除該筆（缺值不等於不合格）', () => {
    const pool = [makeListing({ id: 'A', features: { distToMetro: null } })]
    expect(applyHardFilter(pool, profile({ hard: { maxDistToMetro: 800 } })).map((l) => l.id)).toEqual(['A'])
  })

  it('無條件時回傳同 mode 的全部', () => {
    const pool = [makeListing({ id: 'A' }), makeListing({ id: 'B' })]
    expect(applyHardFilter(pool, profile())).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test lib/scoring/filter.test.ts`
Expected: FAIL — `Failed to resolve import "./filter"`

- [ ] **Step 3: 實作 hard filter**

`lib/scoring/filter.ts`:
```ts
import type { ListingWithFeatures } from '@/lib/types/listing'
import type { SearchProfile } from '@/lib/types/profile'

/**
 * 硬性條件過濾。缺值一律**不排除** —
 * 資料不足不等於不合格，排除會讓結果無聲消失。
 */
export function applyHardFilter(
  pool: ListingWithFeatures[],
  p: SearchProfile,
): ListingWithFeatures[] {
  const h = p.hard
  return pool.filter((l) => {
    if (l.mode !== p.mode) return false
    if (h.cities?.length && !h.cities.includes(l.city)) return false
    if (h.districts?.length && !h.districts.includes(l.district)) return false
    if (h.budgetMin !== undefined && l.price < h.budgetMin) return false
    if (h.budgetMax !== undefined && l.price > h.budgetMax) return false
    if (h.minArea !== undefined && l.area < h.minArea) return false
    if (h.minRooms !== undefined && l.rooms < h.minRooms) return false
    if (h.maxAge !== undefined && l.age > h.maxAge) return false
    if (h.buildingTypes?.length && !h.buildingTypes.includes(l.buildingType)) return false
    if (h.needElevator && !l.hasElevator) return false
    if (h.needParking && !l.hasParking) return false
    if (h.maxDistToMetro !== undefined) {
      const d = l.features.distToMetro
      if (d !== null && d > h.maxDistToMetro) return false
    }
    return true
  })
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm test lib/scoring/filter.test.ts`
Expected: PASS（7 個測試）

- [ ] **Step 5: 寫排序主體的失敗測試**

`lib/scoring/index.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { MAX_PER_DISTRICT, MAX_RESULTS, normalizeWeights, score } from './index'
import { makeListing } from '@/lib/test-utils/factory'
import { DEFAULT_PROFILE, WEIGHT_KEYS, type SearchProfile, type WeightKey } from '@/lib/types/profile'

const profile = (o: Partial<SearchProfile> = {}): SearchProfile => ({ ...DEFAULT_PROFILE, ...o })
const weights = (o: Partial<Record<WeightKey, number>> = {}) => ({ ...DEFAULT_PROFILE.weights, ...o })

describe('normalizeWeights', () => {
  it('總和為 1', () => {
    const w = normalizeWeights(weights({ price: 90, location: 10 }))
    const sum = WEIGHT_KEYS.reduce((s, k) => s + w[k], 0)
    expect(sum).toBeCloseTo(1, 10)
  })

  it('全為 0 時退回等權', () => {
    const w = normalizeWeights({ price: 0, weather: 0, location: 0, amenities: 0, space: 0, quality: 0 })
    for (const k of WEIGHT_KEYS) expect(w[k]).toBeCloseTo(1 / 6, 10)
  })

  it('負值先 clamp 到 0', () => {
    const w = normalizeWeights(weights({ price: -50, weather: 50 }))
    expect(w.price).toBe(0)
  })

  it('超過 100 先 clamp 到 100', () => {
    const a = normalizeWeights(weights({ price: 100 }))
    const b = normalizeWeights(weights({ price: 999 }))
    expect(b.price).toBeCloseTo(a.price, 10)
  })
})

describe('score', () => {
  /** A 便宜但機能差；B 貴但機能好 */
  const cheapPoorAmenities = makeListing({
    id: 'A', district: '土城區', price: 800,
    features: {
      pricePercentile: 0.05,
      poiConvenience500: 1, poiConvenience1k: 2, poiSupermarket500: 0, poiSupermarket1k: 1,
      poiPark500: 0, poiPark1k: 1, poiHospital500: 0, poiHospital1k: 1,
      poiSchool500: 0, poiSchool1k: 1, poiRestaurant500: 2, poiRestaurant1k: 5,
    },
  })
  const pricyRichAmenities = makeListing({
    id: 'B', district: '大安區', price: 4000,
    features: {
      pricePercentile: 0.95,
      poiConvenience500: 14, poiConvenience1k: 40, poiSupermarket500: 6, poiSupermarket1k: 18,
      poiPark500: 4, poiPark1k: 12, poiHospital500: 3, poiHospital1k: 9,
      poiSchool500: 4, poiSchool1k: 12, poiRestaurant500: 60, poiRestaurant1k: 180,
    },
  })

  it('單調性：拉高 price 權重，便宜物件的排名必須上升（不可下降）', () => {
    const pool = [cheapPoorAmenities, pricyRichAmenities]
    const amenityFirst = score(profile({ weights: weights({ price: 5, amenities: 95 }) }), pool)
    const priceFirst = score(profile({ weights: weights({ price: 95, amenities: 5 }) }), pool)
    expect(amenityFirst[0].id).toBe('B')
    expect(priceFirst[0].id).toBe('A')
  })

  it('單調性：同一物件的 price 貢獻隨 price 權重單調不減', () => {
    const pool = [cheapPoorAmenities, pricyRichAmenities]
    const low = score(profile({ weights: weights({ price: 10 }) }), pool).find((r) => r.id === 'A')!
    const high = score(profile({ weights: weights({ price: 90 }) }), pool).find((r) => r.id === 'A')!
    expect(high.breakdown.price.weight).toBeGreaterThan(low.breakdown.price.weight)
  })

  it('breakdown 六維齊全，且 contribution = subscore × weight', () => {
    const [r] = score(profile(), [cheapPoorAmenities, pricyRichAmenities])
    for (const k of WEIGHT_KEYS) {
      const b = r.breakdown[k]
      expect(b).toBeDefined()
      expect(b.contribution).toBeCloseTo(b.subscore * b.weight, 10)
    }
  })

  it('score 等於各維 contribution 之和', () => {
    const [r] = score(profile(), [cheapPoorAmenities, pricyRichAmenities])
    const sum = WEIGHT_KEYS.reduce((s, k) => s + r.breakdown[k].contribution, 0)
    expect(r.score).toBeCloseTo(sum, 10)
  })

  it('結果依分數由高到低排列', () => {
    const pool = Array.from({ length: 12 }, (_, i) =>
      makeListing({ id: `L${i}`, district: `區${i}`, features: { pricePercentile: i / 11 } }))
    const out = score(profile(), pool)
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score)
    }
  })

  it('同一行政區最多保留 MAX_PER_DISTRICT 筆', () => {
    const pool = Array.from({ length: 20 }, (_, i) =>
      makeListing({ id: `L${i}`, district: '大安區', features: { pricePercentile: i / 19 } }))
    const out = score(profile(), pool)
    expect(out.filter((r) => r.district === '大安區')).toHaveLength(MAX_PER_DISTRICT)
  })

  it('最多回傳 MAX_RESULTS 筆', () => {
    const pool = Array.from({ length: 200 }, (_, i) =>
      makeListing({ id: `L${i}`, district: `區${i % 40}`, features: { pricePercentile: (i % 40) / 39 } }))
    expect(score(profile(), pool).length).toBeLessThanOrEqual(MAX_RESULTS)
  })

  it('空池回空陣列', () => {
    expect(score(profile(), [])).toEqual([])
  })

  it('單筆物件不產生 NaN', () => {
    const [r] = score(profile(), [cheapPoorAmenities])
    expect(Number.isNaN(r.score)).toBe(false)
  })

  it('dataGaps 由缺值填補傳遞出來', () => {
    const pool = [makeListing({ id: 'A', features: { aqiMean: null } })]
    expect(score(profile(), pool)[0].dataGaps).toContain('aqiMean')
  })

  it('不符 hard filter 的物件不會出現', () => {
    const pool = [makeListing({ id: 'A', price: 5000 }), makeListing({ id: 'B', district: '板橋區', price: 900 })]
    const out = score(profile({ hard: { budgetMax: 1000 } }), pool)
    expect(out.map((r) => r.id)).toEqual(['B'])
  })
})
```

- [ ] **Step 6: 執行測試確認失敗**

Run: `pnpm test lib/scoring/index.test.ts`
Expected: FAIL — `Failed to resolve import "./index"`

- [ ] **Step 7: 實作排序主體**

`lib/scoring/index.ts`:
```ts
import type { ListingWithFeatures, ScoredListing } from '@/lib/types/listing'
import { WEIGHT_KEYS, type SearchProfile, type WeightKey } from '@/lib/types/profile'
import { DIMENSIONS } from './dimensions'
import { applyHardFilter } from './filter'
import { fillDataGaps } from './gaps'
import { minMaxNormalize } from './normalize'

export const MAX_RESULTS = 30
export const MAX_PER_DISTRICT = 5

const clampWeight = (v: number): number => (v < 0 ? 0 : v > 100 ? 100 : v)

/** 把 0..100 的權重 clamp 後正規化為總和 1；全為 0 時退回等權 */
export function normalizeWeights(
  w: Record<WeightKey, number>,
): Record<WeightKey, number> {
  const clamped = {} as Record<WeightKey, number>
  let total = 0
  for (const k of WEIGHT_KEYS) {
    const v = clampWeight(w[k] ?? 0)
    clamped[k] = v
    total += v
  }
  const out = {} as Record<WeightKey, number>
  for (const k of WEIGHT_KEYS) {
    out[k] = total === 0 ? 1 / WEIGHT_KEYS.length : clamped[k] / total
  }
  return out
}

export function score(
  profile: SearchProfile,
  pool: ListingWithFeatures[],
): ScoredListing[] {
  const candidates = applyHardFilter(pool, profile)
  if (candidates.length === 0) return []

  const filled = fillDataGaps(candidates)
  const weights = normalizeWeights(profile.weights)

  // 每個維度先取原始分數，再在候選池內 min-max 正規化
  const normalized = {} as Record<WeightKey, number[]>
  for (const key of WEIGHT_KEYS) {
    normalized[key] = minMaxNormalize(filled.map((f) => DIMENSIONS[key](f, profile)))
  }

  const scored: ScoredListing[] = filled.map((f, i) => {
    const breakdown = {} as ScoredListing['breakdown']
    let total = 0
    for (const key of WEIGHT_KEYS) {
      const subscore = normalized[key][i]
      const weight = weights[key]
      const contribution = subscore * weight
      breakdown[key] = { subscore, weight, contribution }
      total += contribution
    }
    return { ...f.listing, score: total, breakdown, dataGaps: f.dataGaps }
  })

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))

  // 多樣性：同一行政區最多 MAX_PER_DISTRICT 筆，避免結果全擠一區
  const perDistrict = new Map<string, number>()
  const diverse: ScoredListing[] = []
  for (const r of scored) {
    const key = `${r.city}|${r.district}`
    const n = perDistrict.get(key) ?? 0
    if (n >= MAX_PER_DISTRICT) continue
    perDistrict.set(key, n + 1)
    diverse.push(r)
    if (diverse.length >= MAX_RESULTS) break
  }
  return diverse
}
```

- [ ] **Step 8: 執行測試確認通過**

Run: `pnpm test lib/scoring/index.test.ts`
Expected: PASS（15 個測試）

- [ ] **Step 9: 寫放寬策略的失敗測試**

`lib/scoring/relax.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { rankWithRelaxation } from './relax'
import { makeListing } from '@/lib/test-utils/factory'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'

const profile = (o: Partial<SearchProfile> = {}): SearchProfile => ({ ...DEFAULT_PROFILE, ...o })

describe('rankWithRelaxation', () => {
  it('有結果時不放寬任何條件', () => {
    const pool = [makeListing({ id: 'A', price: 900 })]
    const out = rankWithRelaxation(profile({ hard: { budgetMax: 1000 } }), pool)
    expect(out.results.map((r) => r.id)).toEqual(['A'])
    expect(out.relaxations).toEqual([])
  })

  it('捷運距離過嚴時先放寬捷運距離', () => {
    const pool = [makeListing({ id: 'A', features: { distToMetro: 900 } })]
    const out = rankWithRelaxation(profile({ hard: { maxDistToMetro: 600 } }), pool)
    expect(out.results).toHaveLength(1)
    expect(out.relaxations.join()).toContain('捷運')
  })

  it('屋齡過嚴時放寬屋齡', () => {
    const pool = [makeListing({ id: 'A', age: 25 })]
    const out = rankWithRelaxation(profile({ hard: { maxAge: 20 } }), pool)
    expect(out.results).toHaveLength(1)
    expect(out.relaxations.join()).toContain('屋齡')
  })

  it('預算過嚴時放寬預算，且說明含新的數字', () => {
    const pool = [makeListing({ id: 'A', price: 1100 })]
    const out = rankWithRelaxation(profile({ hard: { budgetMax: 1000 } }), pool)
    expect(out.results).toHaveLength(1)
    expect(out.relaxations.join()).toContain('1150')
  })

  it('行政區過嚴時擴大到整個城市', () => {
    const pool = [makeListing({ id: 'A', city: '臺北市', district: '北投區' })]
    const out = rankWithRelaxation(profile({ hard: { cities: ['臺北市'], districts: ['大安區'] } }), pool)
    expect(out.results).toHaveLength(1)
    expect(out.relaxations.join()).toContain('行政區')
  })

  it('全部放寬後仍無結果時，回空陣列並說明已無符合物件', () => {
    const pool = [makeListing({ id: 'A', mode: 'rent' })]
    const out = rankWithRelaxation(profile({ mode: 'sale' }), pool)
    expect(out.results).toEqual([])
    expect(out.relaxations.length).toBeGreaterThan(0)
  })

  it('一有結果就停止放寬，不會過度放寬', () => {
    const pool = [makeListing({ id: 'A', features: { distToMetro: 900 } })]
    const out = rankWithRelaxation(profile({ hard: { maxDistToMetro: 600, maxAge: 20 } }), pool)
    expect(out.relaxations).toHaveLength(1)
  })
})
```

- [ ] **Step 10: 執行測試確認失敗**

Run: `pnpm test lib/scoring/relax.test.ts`
Expected: FAIL — `Failed to resolve import "./relax"`

- [ ] **Step 11: 實作放寬策略**

`lib/scoring/relax.ts`:
```ts
import type { ListingWithFeatures, RankResult } from '@/lib/types/listing'
import type { SearchProfile } from '@/lib/types/profile'
import { score } from './index'

interface RelaxStep {
  /** 此步驟是否適用於目前的 profile */
  applies: (p: SearchProfile) => boolean
  /** 回傳放寬後的 profile 與給使用者的說明 */
  apply: (p: SearchProfile) => { profile: SearchProfile; message: string }
}

const RELAX_STEPS: RelaxStep[] = [
  {
    applies: (p) => p.hard.maxDistToMetro !== undefined,
    apply: (p) => {
      const next = Math.round(p.hard.maxDistToMetro! * 1.5)
      return {
        profile: { ...p, hard: { ...p.hard, maxDistToMetro: next } },
        message: `把離捷運的距離放寬到 ${next} 公尺`,
      }
    },
  },
  {
    applies: (p) => p.hard.maxAge !== undefined,
    apply: (p) => {
      const next = p.hard.maxAge! + 10
      return {
        profile: { ...p, hard: { ...p.hard, maxAge: next } },
        message: `把屋齡上限放寬到 ${next} 年`,
      }
    },
  },
  {
    applies: (p) => p.hard.minArea !== undefined,
    apply: (p) => {
      const next = Math.round(p.hard.minArea! * 0.8 * 10) / 10
      return {
        profile: { ...p, hard: { ...p.hard, minArea: next } },
        message: `把最小坪數放寬到 ${next} 坪`,
      }
    },
  },
  {
    applies: (p) => p.hard.budgetMax !== undefined,
    apply: (p) => {
      const next = Math.round(p.hard.budgetMax! * 1.15)
      return {
        profile: { ...p, hard: { ...p.hard, budgetMax: next } },
        message: `把預算上限放寬到 ${next}`,
      }
    },
  },
  {
    applies: (p) => (p.hard.districts?.length ?? 0) > 0,
    apply: (p) => {
      const { districts: _dropped, ...rest } = p.hard
      return {
        profile: { ...p, hard: rest },
        message: '把範圍從指定行政區擴大到整個城市',
      }
    },
  },
  {
    applies: (p) => Object.keys(p.hard).some((k) => k !== 'cities'),
    apply: (p) => ({
      profile: { ...p, hard: p.hard.cities ? { cities: p.hard.cities } : {} },
      message: '暫時拿掉其餘篩選條件，只保留地區',
    }),
  },
]

/**
 * 依序放寬條件直到有結果為止，一有結果就停。
 * relaxations 必須由 agent 在回覆中明講 — 悄悄放寬會讓使用者誤以為結果符合原條件。
 */
export function rankWithRelaxation(
  profile: SearchProfile,
  pool: ListingWithFeatures[],
): RankResult {
  const direct = score(profile, pool)
  if (direct.length > 0) return { results: direct, relaxations: [] }

  let current = profile
  const relaxations: string[] = []

  for (const step of RELAX_STEPS) {
    if (!step.applies(current)) continue
    const { profile: relaxed, message } = step.apply(current)
    current = relaxed
    relaxations.push(message)
    const results = score(current, pool)
    if (results.length > 0) return { results, relaxations }
  }

  relaxations.push('放寬所有條件後仍找不到符合的物件')
  return { results: [], relaxations }
}
```

- [ ] **Step 12: 執行測試確認通過**

Run: `pnpm test`
Expected: PASS（30 + filter 7 + index 15 + relax 7 = 59 個測試）

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(scoring): hard filter、加權排序、多樣性上限與放寬策略"
```

---

### Task 4: Profile 合併驗證與 /api/rank

**Files:**
- Create: `lib/profile/merge.ts`, `lib/profile/schema.ts`
- Create: `app/api/rank/route.ts`
- Test: `lib/profile/merge.test.ts`, `lib/profile/schema.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `SearchProfile`、`DEFAULT_PROFILE`、`WEIGHT_KEYS`、`loadPool`；Task 3 的 `rankWithRelaxation`
- Produces:
  - `ProfileDelta { mode?, weightsDelta?, hard?, soft?, note? }`
  - `mergeProfile(current: SearchProfile, delta: ProfileDelta): SearchProfile`
  - `searchProfileSchema`、`profileDeltaSchema`（Zod）
  - `parseProfile(input: unknown): SearchProfile`（失敗時回 `DEFAULT_PROFILE`，不拋錯）
  - `POST /api/rank` → `{ results, relaxations }`

- [ ] **Step 1: 寫 merge 的失敗測試**

`lib/profile/merge.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { mergeProfile } from './merge'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'

const base = (o: Partial<SearchProfile> = {}): SearchProfile =>
  structuredClone({ ...DEFAULT_PROFILE, ...o })

describe('mergeProfile', () => {
  it('權重是增量疊加，未提及的維度不動', () => {
    const out = mergeProfile(base(), { weightsDelta: { location: 20 } })
    expect(out.weights.location).toBe(70)
    expect(out.weights.price).toBe(50)
  })

  it('權重 clamp 在 0..100', () => {
    const high = mergeProfile(base(), { weightsDelta: { price: 999 } })
    const low = mergeProfile(base(), { weightsDelta: { price: -999 } })
    expect(high.weights.price).toBe(100)
    expect(low.weights.price).toBe(0)
  })

  it('hard 條件覆蓋既有值', () => {
    const out = mergeProfile(base({ hard: { budgetMax: 2000 } }), { hard: { budgetMax: 1500 } })
    expect(out.hard.budgetMax).toBe(1500)
  })

  it('hard 中未提及的欄位保留', () => {
    const out = mergeProfile(base({ hard: { budgetMax: 2000, minRooms: 2 } }), { hard: { minRooms: 3 } })
    expect(out.hard.budgetMax).toBe(2000)
    expect(out.hard.minRooms).toBe(3)
  })

  it('hard 欄位設為 null 表示移除該條件', () => {
    const out = mergeProfile(base({ hard: { budgetMax: 2000 } }), { hard: { budgetMax: null } })
    expect(out.hard.budgetMax).toBeUndefined()
  })

  it('soft 偏好合併', () => {
    const out = mergeProfile(base({ soft: { prefersCool: true } }), { soft: { prefersQuiet: 1 } })
    expect(out.soft.prefersCool).toBe(true)
    expect(out.soft.prefersQuiet).toBe(1)
  })

  it('note 累加到 notes', () => {
    const out = mergeProfile(base({ notes: ['第一句'] }), { note: '第二句' })
    expect(out.notes).toEqual(['第一句', '第二句'])
  })

  it('notes 最多保留最近 10 筆', () => {
    const many = Array.from({ length: 10 }, (_, i) => `n${i}`)
    const out = mergeProfile(base({ notes: many }), { note: 'new' })
    expect(out.notes).toHaveLength(10)
    expect(out.notes.at(-1)).toBe('new')
    expect(out.notes[0]).toBe('n1')
  })

  it('切換 mode 時清空預算條件（買賣與租金量級不同）', () => {
    const out = mergeProfile(
      base({ mode: 'sale', hard: { budgetMax: 2000, budgetMin: 800, minRooms: 2 } }),
      { mode: 'rent' },
    )
    expect(out.mode).toBe('rent')
    expect(out.hard.budgetMax).toBeUndefined()
    expect(out.hard.budgetMin).toBeUndefined()
    expect(out.hard.minRooms).toBe(2)
  })

  it('mode 不變時不清空預算', () => {
    const out = mergeProfile(base({ mode: 'sale', hard: { budgetMax: 2000 } }), { mode: 'sale' })
    expect(out.hard.budgetMax).toBe(2000)
  })

  it('切換 mode 時，同批 delta 帶來的新預算不被清掉', () => {
    const out = mergeProfile(
      base({ mode: 'sale', hard: { budgetMax: 2000 } }),
      { mode: 'rent', hard: { budgetMax: 25000 } },
    )
    expect(out.hard.budgetMax).toBe(25000)
  })

  it('不修改傳入的 profile', () => {
    const original = base()
    mergeProfile(original, { weightsDelta: { price: 30 }, note: 'x' })
    expect(original.weights.price).toBe(50)
    expect(original.notes).toEqual([])
  })

  it('空 delta 回傳等值的 profile', () => {
    const original = base({ hard: { budgetMax: 1500 } })
    expect(mergeProfile(original, {})).toEqual(original)
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test lib/profile/merge.test.ts`
Expected: FAIL — `Failed to resolve import "./merge"`

- [ ] **Step 3: 實作 merge**

`lib/profile/merge.ts`:
```ts
import {
  WEIGHT_KEYS,
  type HardConstraints,
  type Mode,
  type SearchProfile,
  type SoftPrefs,
  type WeightKey,
} from '@/lib/types/profile'

/** hard 欄位傳 null 代表「移除這個條件」 */
export type HardDelta = { [K in keyof HardConstraints]?: HardConstraints[K] | null }

export interface ProfileDelta {
  mode?: Mode
  weightsDelta?: Partial<Record<WeightKey, number>>
  hard?: HardDelta
  soft?: SoftPrefs
  note?: string
}

const MAX_NOTES = 10
/** 切換買/租時必須清空的欄位 — 量級完全不同，沿用會濾成 0 筆 */
const MODE_SENSITIVE_HARD_KEYS = ['budgetMin', 'budgetMax'] as const

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

export function mergeProfile(current: SearchProfile, delta: ProfileDelta): SearchProfile {
  const mode = delta.mode ?? current.mode
  const modeChanged = mode !== current.mode

  const weights = { ...current.weights }
  for (const key of WEIGHT_KEYS) {
    const d = delta.weightsDelta?.[key]
    if (typeof d === 'number' && Number.isFinite(d)) {
      weights[key] = clamp(weights[key] + d, 0, 100)
    }
  }

  const hard: HardConstraints = { ...current.hard }
  if (modeChanged) {
    for (const key of MODE_SENSITIVE_HARD_KEYS) delete hard[key]
  }
  for (const [key, value] of Object.entries(delta.hard ?? {})) {
    const k = key as keyof HardConstraints
    if (value === null || value === undefined) {
      delete hard[k]
    } else {
      // 值已由 Zod schema 驗證過型別，此處只做合併
      Object.assign(hard, { [k]: value })
    }
  }

  const soft: SoftPrefs = { ...current.soft, ...delta.soft }

  const notes = delta.note
    ? [...current.notes, delta.note].slice(-MAX_NOTES)
    : [...current.notes]

  return { mode, weights, hard, soft, notes }
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm test lib/profile/merge.test.ts`
Expected: PASS（13 個測試）

- [ ] **Step 5: 寫 Zod schema 的失敗測試**

`lib/profile/schema.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseProfile, profileDeltaSchema } from './schema'
import { DEFAULT_PROFILE } from '@/lib/types/profile'

describe('parseProfile', () => {
  it('接受合法的 profile', () => {
    const p = parseProfile({ ...DEFAULT_PROFILE, hard: { budgetMax: 1500 } })
    expect(p.hard.budgetMax).toBe(1500)
  })

  it('完全不合法時退回預設 profile，不拋錯', () => {
    expect(parseProfile('垃圾')).toEqual(DEFAULT_PROFILE)
    expect(parseProfile(null)).toEqual(DEFAULT_PROFILE)
    expect(parseProfile({ mode: '亂寫' })).toEqual(DEFAULT_PROFILE)
  })

  it('權重越界時 clamp 而非整包失敗', () => {
    const p = parseProfile({ ...DEFAULT_PROFILE, weights: { ...DEFAULT_PROFILE.weights, price: 500 } })
    expect(p.weights.price).toBe(100)
  })

  it('缺少的權重維度補回預設值', () => {
    const p = parseProfile({ ...DEFAULT_PROFILE, weights: { price: 80 } })
    expect(p.weights.price).toBe(80)
    expect(p.weights.weather).toBe(50)
  })
})

describe('profileDeltaSchema', () => {
  it('接受空物件', () => {
    expect(profileDeltaSchema.parse({})).toEqual({})
  })

  it('weightsDelta clamp 在 -100..100', () => {
    const d = profileDeltaSchema.parse({ weightsDelta: { price: 9999 } })
    expect(d.weightsDelta?.price).toBe(100)
  })

  it('丟棄未知欄位而不是整包失敗', () => {
    const d = profileDeltaSchema.parse({ 亂寫: 1, weightsDelta: { price: 10 } })
    expect(d).not.toHaveProperty('亂寫')
    expect(d.weightsDelta?.price).toBe(10)
  })

  it('負的預算被 clamp 到 0', () => {
    const d = profileDeltaSchema.parse({ hard: { budgetMax: -5 } })
    expect(d.hard?.budgetMax).toBe(0)
  })

  it('hard 欄位可傳 null 表示移除', () => {
    const d = profileDeltaSchema.parse({ hard: { budgetMax: null } })
    expect(d.hard?.budgetMax).toBeNull()
  })

  it('commuteAnchor 座標超出台灣範圍時整個錨點被丟棄', () => {
    const d = profileDeltaSchema.parse({ soft: { commuteAnchor: { lat: 80, lng: 10, label: '北極' } } })
    expect(d.soft?.commuteAnchor).toBeUndefined()
  })

  it('接受台灣範圍內的 commuteAnchor', () => {
    const d = profileDeltaSchema.parse({
      soft: { commuteAnchor: { lat: 25.033, lng: 121.565, label: '信義區', maxMin: 40 } },
    })
    expect(d.soft?.commuteAnchor?.label).toBe('信義區')
  })
})
```

- [ ] **Step 6: 執行測試確認失敗**

Run: `pnpm test lib/profile/schema.test.ts`
Expected: FAIL — `Failed to resolve import "./schema"`

- [ ] **Step 7: 實作 Zod schema**

`lib/profile/schema.ts`:
```ts
import { z } from 'zod'
import { DEFAULT_PROFILE, WEIGHT_KEYS, type SearchProfile } from '@/lib/types/profile'

/** 台灣本島與離島的概略經緯度範圍，用來擋掉模型幻覺出的座標 */
const TW_LAT = { min: 21.5, max: 26.5 }
const TW_LNG = { min: 118.0, max: 122.5 }

const modeSchema = z.enum(['sale', 'rent'])

const weightsSchema = z
  .record(z.enum(WEIGHT_KEYS as unknown as [string, ...string[]]), z.number())
  .optional()
  .transform((w) => {
    const out = { ...DEFAULT_PROFILE.weights }
    for (const k of WEIGHT_KEYS) {
      const v = w?.[k]
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[k] = Math.min(100, Math.max(0, v))
      }
    }
    return out
  })

const nonNegative = z.number().finite().transform((v) => Math.max(0, v))

const hardSchema = z.object({
  cities: z.array(z.string().min(1)).max(6).optional(),
  districts: z.array(z.string().min(1)).max(30).optional(),
  budgetMin: nonNegative.optional(),
  budgetMax: nonNegative.optional(),
  minArea: nonNegative.optional(),
  minRooms: z.number().int().min(0).max(10).optional(),
  maxAge: nonNegative.optional(),
  buildingTypes: z.array(z.string().min(1)).max(10).optional(),
  needElevator: z.boolean().optional(),
  needParking: z.boolean().optional(),
  maxDistToMetro: nonNegative.optional(),
})

const commuteAnchorSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
    label: z.string().min(1).max(40),
    maxMin: z.number().min(1).max(180).optional(),
  })
  .refine(
    (a) =>
      a.lat >= TW_LAT.min && a.lat <= TW_LAT.max &&
      a.lng >= TW_LNG.min && a.lng <= TW_LNG.max,
    { message: 'commuteAnchor 座標不在台灣範圍內' },
  )

const softSchema = z.object({
  prefersCool: z.boolean().optional(),
  prefersLowRain: z.boolean().optional(),
  prefersQuiet: z.number().min(-1).max(1).optional(),
  // 座標不合法時只丟掉錨點，其餘偏好照常保留
  commuteAnchor: commuteAnchorSchema.optional().catch(undefined),
})

export const searchProfileSchema = z.object({
  mode: modeSchema,
  weights: weightsSchema,
  hard: hardSchema.optional().transform((h) => h ?? {}),
  soft: softSchema.optional().transform((s) => s ?? {}),
  notes: z.array(z.string()).max(10).optional().transform((n) => n ?? []),
})

/** 不拋錯：任何不合法輸入都退回預設 profile，避免整條請求失敗 */
export function parseProfile(input: unknown): SearchProfile {
  const parsed = searchProfileSchema.safeParse(input)
  return parsed.success ? parsed.data : structuredClone(DEFAULT_PROFILE)
}

const clampDelta = z
  .number()
  .finite()
  .transform((v) => Math.min(100, Math.max(-100, v)))

const hardDeltaSchema = z.object({
  cities: z.array(z.string().min(1)).max(6).nullable().optional(),
  districts: z.array(z.string().min(1)).max(30).nullable().optional(),
  budgetMin: nonNegative.nullable().optional(),
  budgetMax: nonNegative.nullable().optional(),
  minArea: nonNegative.nullable().optional(),
  minRooms: z.number().int().min(0).max(10).nullable().optional(),
  maxAge: nonNegative.nullable().optional(),
  buildingTypes: z.array(z.string().min(1)).max(10).nullable().optional(),
  needElevator: z.boolean().nullable().optional(),
  needParking: z.boolean().nullable().optional(),
  maxDistToMetro: nonNegative.nullable().optional(),
})

/** 模型輸出的變動量。未知欄位一律丟棄，不讓單一幻覺欄位炸掉整包。 */
export const profileDeltaSchema = z.object({
  mode: modeSchema.optional(),
  weightsDelta: z
    .record(z.enum(WEIGHT_KEYS as unknown as [string, ...string[]]), clampDelta)
    .optional(),
  hard: hardDeltaSchema.optional(),
  soft: softSchema.optional(),
  note: z.string().max(200).optional(),
})

export type ParsedProfileDelta = z.infer<typeof profileDeltaSchema>
```

- [ ] **Step 8: 執行測試確認通過**

Run: `pnpm test lib/profile/schema.test.ts`
Expected: PASS（11 個測試）

- [ ] **Step 9: 實作 /api/rank**

`app/api/rank/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { loadPool } from '@/lib/db/client'
import { parseProfile } from '@/lib/profile/schema'
import { rankWithRelaxation } from '@/lib/scoring/relax'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }

  const profile = parseProfile((body as { profile?: unknown } | null)?.profile)

  try {
    const pool = loadPool(profile.mode, profile.hard.cities)
    return NextResponse.json(rankWithRelaxation(profile, pool))
  } catch (error) {
    console.error('[api/rank] 排序失敗', error)
    return NextResponse.json({ error: '資料庫尚未建立，請先執行 pnpm db:push && pnpm db:seed' }, { status: 500 })
  }
}
```

- [ ] **Step 10: 手動驗證 API**

```bash
pnpm dev &
sleep 5
curl -s -X POST http://localhost:3000/api/rank \
  -H 'content-type: application/json' \
  -d '{"profile":{"mode":"sale","weights":{"price":90,"weather":30,"location":50,"amenities":50,"space":50,"quality":50},"hard":{"cities":["臺北市"]},"soft":{},"notes":[]}}' \
  | head -c 600
```
Expected: JSON 含 `"results"` 陣列，第一筆的 `district` 應為單價較低的行政區（萬華／文山／北投之一），且 `relaxations` 為 `[]`

驗證完關閉：`kill %1`

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(api): profile 合併與驗證，加上 /api/rank 排序端點"
```

---

### Task 4B: 把價格拆成 price（跨區可負擔）與 value（同區性價比）

**為什麼**：`pricePercentile` 是在「同 mode + 同城市 + 同行政區 + 同建物型態」內算的，所以每個行政區的百分位
都必然跑滿 0 到 1。實測種子資料：大安區單價 100.4 萬/坪的物件與土城區 30.9 萬/坪的物件，`1 - pricePercentile`
都是滿分 1.0 —— 單價差 3.2 倍、價格分數相同。原本的 `price` 維度**對跨區可負擔性完全失明**，而「我該住哪一區」
正是本產品的核心問題。拆成兩個獨立維度後，使用者可以分別表達「我要便宜的區」與「我要划算的物件」。

**Files:**
- Modify: `lib/types/profile.ts`（`WeightKey`、`WEIGHT_KEYS`、`WEIGHT_LABELS`、`DEFAULT_PROFILE`）
- Modify: `lib/scoring/dimensions.ts`（改寫 `price`、新增 `value`、`DIMENSIONS`）
- Modify: `lib/scoring/dimensions.test.ts`
- Modify: `lib/scoring/index.test.ts`（fixture 需要不同的 `unitPrice`；等權值 1/6 → 1/7）
- Modify: `lib/profile/schema.ts`（兩份 weights schema 各加一鍵）

**Interfaces:**
- Consumes: Task 1–4 的既有匯出
- Produces: `WeightKey` 增為七鍵，順序固定 `price` `value` `weather` `location` `amenities` `space` `quality`

- [ ] **Step 1: 擴充型別**

`lib/types/profile.ts` — `WeightKey` 加入 `'value'`，三個常數同步：

```ts
export type WeightKey =
  | 'price'
  | 'value'
  | 'weather'
  | 'location'
  | 'amenities'
  | 'space'
  | 'quality'

export const WEIGHT_KEYS: readonly WeightKey[] = [
  'price', 'value', 'weather', 'location', 'amenities', 'space', 'quality',
] as const

export const WEIGHT_LABELS: Record<WeightKey, string> = {
  price: '房價可負擔',
  value: '同區性價比',
  weather: '天氣環境',
  location: '地理位置',
  amenities: '生活機能',
  space: '坪數格局',
  quality: '屋況條件',
}
```

`DEFAULT_PROFILE.weights` 加上 `value: 50`（七項皆 50）。

- [ ] **Step 2: 先寫失敗測試**

`lib/scoring/dimensions.test.ts` — 把原本的 `describe('DIMENSIONS.price')` 整段換成下面兩段。
第二段的兩個測試是這次拆分的核心證據：同一組數字，`price` 必須分得出高下，`value` 必須分不出。

```ts
describe('DIMENSIONS.price', () => {
  it('單價越低分數越高', () => {
    const cheap = DIMENSIONS.price(fill(makeListing({ unitPrice: 31 })), profile())
    const pricey = DIMENSIONS.price(fill(makeListing({ unitPrice: 100 })), profile())
    expect(cheap).toBeGreaterThan(pricey)
  })

  it('跨行政區可比：貴區裡最便宜的仍輸給便宜區裡最便宜的', () => {
    const daanCheapest = DIMENSIONS.price(
      fill(makeListing({ unitPrice: 100.4, features: { pricePercentile: 0 } })), profile())
    const tuchengCheapest = DIMENSIONS.price(
      fill(makeListing({ unitPrice: 30.9, features: { pricePercentile: 0 } })), profile())
    expect(tuchengCheapest).toBeGreaterThan(daanCheapest)
  })

  it('不受同區百分位影響', () => {
    const a = DIMENSIONS.price(fill(makeListing({ unitPrice: 50, features: { pricePercentile: 0 } })), profile())
    const b = DIMENSIONS.price(fill(makeListing({ unitPrice: 50, features: { pricePercentile: 1 } })), profile())
    expect(a).toBe(b)
  })

  it('有 budgetMax 也不改變公式（單調性不變量）', () => {
    const p = profile({ hard: { budgetMax: 3000 } })
    const cheap = DIMENSIONS.price(fill(makeListing({ unitPrice: 31 })), p)
    const pricey = DIMENSIONS.price(fill(makeListing({ unitPrice: 100 })), p)
    expect(cheap).toBeGreaterThan(pricey)
  })
})

describe('DIMENSIONS.value', () => {
  it('同區百分位越低分數越高', () => {
    const cheap = DIMENSIONS.value(fill(makeListing({ features: { pricePercentile: 0.1 } })), profile())
    const pricey = DIMENSIONS.value(fill(makeListing({ features: { pricePercentile: 0.9 } })), profile())
    expect(cheap).toBeGreaterThan(pricey)
  })

  it('與絕對單價無關：兩區各自墊底的物件得分相同', () => {
    const daan = DIMENSIONS.value(
      fill(makeListing({ unitPrice: 100.4, features: { pricePercentile: 0 } })), profile())
    const tucheng = DIMENSIONS.value(
      fill(makeListing({ unitPrice: 30.9, features: { pricePercentile: 0 } })), profile())
    expect(daan).toBe(tucheng)
  })

  it('有 budgetMax 也不改變公式（單調性不變量）', () => {
    const p = profile({ hard: { budgetMax: 3000 } })
    const cheap = DIMENSIONS.value(fill(makeListing({ features: { pricePercentile: 0.1 } })), p)
    const pricey = DIMENSIONS.value(fill(makeListing({ features: { pricePercentile: 0.9 } })), p)
    expect(cheap).toBeGreaterThan(pricey)
  })
})
```

同檔案最後的完整性測試，鍵陣列補上 `'value'`：
```ts
    for (const key of ['price', 'value', 'weather', 'location', 'amenities', 'space', 'quality'] as const) {
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `pnpm test lib/scoring/dimensions.test.ts`
Expected: FAIL — `DIMENSIONS.value is not a function`，以及 price 的跨區測試因為舊公式讀 `pricePercentile` 而失敗

- [ ] **Step 4: 改寫維度**

`lib/scoring/dimensions.ts` — 把原本的 `price` 換成下面兩個函式：

```ts
/**
 * 房價可負擔：跨行政區的絕對單價水準。
 * 回傳 -unitPrice，下游在候選池內 min-max 正規化後即「單價越低越高分」。
 * 刻意用單價而非總價 —— 總價混入了坪數大小，單價才隔離出「這個地段多貴」；
 * 總價上限由 hard.budgetMax 這個硬條件處理，不需要在分數裡重複表達。
 */
const price: DimensionFn = (f) => -f.listing.unitPrice

/**
 * 同區性價比：同區同型態內相對便宜的程度。
 * 恆為 1 - pricePercentile，不因 budgetMax 改變曲線 ——
 * 「貼近預算上限為佳」會破壞「拉高權重 → 便宜物件排名上升」的單調性不變量。
 * 這個維度**刻意**對跨區的絕對價差失明，那是 price 的職責。
 */
const value: DimensionFn = (f) => 1 - clamp01(f.features.pricePercentile)
```

`DIMENSIONS` 常數加入 `value`：
```ts
export const DIMENSIONS: Record<WeightKey, DimensionFn> = {
  price, value, weather, location, amenities, space, quality,
}
```

- [ ] **Step 5: 執行測試確認通過**

Run: `pnpm test lib/scoring/dimensions.test.ts`
Expected: PASS

- [ ] **Step 6: 修正排序測試的 fixture**

`lib/scoring/index.test.ts` 的兩筆 fixture 目前沒設 `unitPrice`，都會拿到工廠預設值 80，
使 `price` 維度分不出高下、單調性測試失效。各補一個 `unitPrice`：

- `cheapPoorAmenities` 加 `unitPrice: 31`
- `pricyRichAmenities` 加 `unitPrice: 100`

`normalizeWeights` 的全零測試，物件字面值補 `value: 0`，且期望值由 `1 / 6` 改為 `1 / 7`：
```ts
  it('全為 0 時退回等權', () => {
    const w = normalizeWeights({ price: 0, value: 0, weather: 0, location: 0, amenities: 0, space: 0, quality: 0 })
    for (const k of WEIGHT_KEYS) expect(w[k]).toBeCloseTo(1 / 7, 10)
  })
```

其餘測試用 `{ ...DEFAULT_PROFILE.weights, ... }` 展開，會自動跟著擴充，不需改動。

- [ ] **Step 7: 補上 schema 的第七鍵**

`lib/profile/schema.ts` 有兩份各自列出權重鍵的 schema（Task 4 審查已標記這個重複）。
**兩份都要加 `value`** —— 只改一份會讓絕對 profile 與增量 delta 的行為不一致。

- [ ] **Step 8: 全套驗證**

```bash
pnpm test
pnpm exec tsc --noEmit
```
Expected: 全綠。任何測試若因為權重鍵數量而失敗，是該測試需要補鍵，不是把 `value` 拿掉。

- [ ] **Step 9: 用真實資料確認缺陷已修復**

```bash
node -e "
const D=require('better-sqlite3');const db=new D('./data/app.db',{readonly:true});
const rows=db.prepare(\"SELECT l.district,l.unit_price u,f.price_percentile p FROM listings l JOIN listing_features f ON l.id=f.listing_id WHERE l.mode='sale' AND f.price_percentile=0\").all();
const daan=rows.find(r=>r.district==='大安區'), tu=rows.find(r=>r.district==='土城區');
console.log('大安墊底單價',daan.u,'土城墊底單價',tu.u);
console.log('舊 price(=1-pct) 兩者相同:', (1-daan.p)===(1-tu.p));
console.log('新 price(=-unitPrice) 土城較高:', (-tu.u) > (-daan.u));
db.close();"
```
Expected: 最後兩行分別為 `true` 與 `true`

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(scoring): 拆分 price（跨區可負擔）與 value（同區性價比）"
```

---

### Task 5: 結果視圖 — 地圖與物件卡片

**Files:**
- Create: `lib/client/format.ts`
- Create: `hooks/useSearchState.ts`
- Create: `components/MapView/mapStyle.ts`, `components/MapView/MapView.tsx`
- Create: `components/ListingCard/BreakdownBars.tsx`, `components/ListingCard/ListingCard.tsx`, `components/ListingCard/ResultStrip.tsx`
- Modify: `app/page.tsx`（換成結果視圖；Task 9 再加對話欄）
- Test: `lib/client/format.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ScoredListing`、`SearchProfile`、`DEFAULT_PROFILE`、`WEIGHT_KEYS`、`WEIGHT_LABELS`；Task 4 的 `POST /api/rank`
- Produces:
  - `formatPrice(listing): string`、`formatArea(n): string`、`formatDistance(m): string`、`formatCommute(min): string`
  - `useSearchState()` → `{ profile, setProfile, results, setResults, relaxations, setRelaxations, loading, error, hoveredId, setHoveredId, rank }`
    （`setResults` 與 `setRelaxations` 供 Task 9 的 `useChat` 直接寫入 SSE 回傳的結果）
  - `<MapView results hoveredId onHover onSelect />`
  - `<ResultStrip results hoveredId onHover />`

- [ ] **Step 1: 寫格式化函式的失敗測試**

`lib/client/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { formatArea, formatCommute, formatDistance, formatPrice } from './format'

describe('formatPrice', () => {
  it('買賣以「萬」為單位，超過一億改用「億」', () => {
    expect(formatPrice({ mode: 'sale', price: 1580 })).toBe('1,580 萬')
    expect(formatPrice({ mode: 'sale', price: 12000 })).toBe('1.2 億')
  })

  it('租賃以「元/月」表示並加千分位', () => {
    expect(formatPrice({ mode: 'rent', price: 25000 })).toBe('25,000 元/月')
  })
})

describe('formatArea', () => {
  it('保留一位小數並加單位', () => {
    expect(formatArea(25.44)).toBe('25.4 坪')
  })
})

describe('formatDistance', () => {
  it('未滿 1 公里用公尺', () => {
    expect(formatDistance(650)).toBe('650 公尺')
  })

  it('滿 1 公里改用公里', () => {
    expect(formatDistance(2400)).toBe('2.4 公里')
  })

  it('null 顯示為資料不足', () => {
    expect(formatDistance(null)).toBe('—')
  })
})

describe('formatCommute', () => {
  it('四捨五入到分鐘並標示為估計值', () => {
    expect(formatCommute(28.6)).toBe('約 29 分鐘')
  })

  it('null 顯示為資料不足', () => {
    expect(formatCommute(null)).toBe('—')
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test lib/client/format.test.ts`
Expected: FAIL — `Failed to resolve import "./format"`

- [ ] **Step 3: 實作格式化函式**

`lib/client/format.ts`:
```ts
import type { Mode } from '@/lib/types/profile'

const withThousands = (n: number): string => n.toLocaleString('zh-Hant-TW')

/** 買賣：萬元總價（破億改用億）；租賃：元/月 */
export function formatPrice(l: { mode: Mode; price: number }): string {
  if (l.mode === 'rent') return `${withThousands(Math.round(l.price))} 元/月`
  if (l.price >= 10_000) return `${(l.price / 10_000).toFixed(1)} 億`
  return `${withThousands(Math.round(l.price))} 萬`
}

export function formatArea(ping: number): string {
  return `${ping.toFixed(1)} 坪`
}

export function formatDistance(meters: number | null): string {
  if (meters === null) return '—'
  if (meters < 1000) return `${Math.round(meters)} 公尺`
  return `${(meters / 1000).toFixed(1)} 公里`
}

export function formatCommute(minutes: number | null): string {
  if (minutes === null) return '—'
  return `約 ${Math.round(minutes)} 分鐘`
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm test lib/client/format.test.ts`
Expected: PASS（8 個測試）

- [ ] **Step 5: 實作前端狀態 hook**

`hooks/useSearchState.ts`:
```ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScoredListing } from '@/lib/types/listing'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'

const STORAGE_KEY = 'housing-agent.profile.v1'

function loadStoredProfile(): SearchProfile {
  if (typeof window === 'undefined') return DEFAULT_PROFILE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULT_PROFILE, ...JSON.parse(raw) } : DEFAULT_PROFILE
  } catch {
    return DEFAULT_PROFILE
  }
}

export function useSearchState() {
  const [profile, setProfileState] = useState<SearchProfile>(DEFAULT_PROFILE)
  const [results, setResults] = useState<ScoredListing[]>([])
  const [relaxations, setRelaxations] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const requestSeq = useRef(0)

  // localStorage 只能在掛載後讀取，避免 SSR / CSR 內容不一致
  useEffect(() => { setProfileState(loadStoredProfile()) }, [])

  const setProfile = useCallback((next: SearchProfile) => {
    setProfileState(next)
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* 無痕模式可忽略 */ }
  }, [])

  const rank = useCallback(async (target: SearchProfile) => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/rank', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: target }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { results: ScoredListing[]; relaxations: string[] }
      // 舊請求的回應不得覆蓋新結果
      if (seq !== requestSeq.current) return
      setResults(data.results)
      setRelaxations(data.relaxations)
    } catch {
      if (seq !== requestSeq.current) return
      setError('排序失敗，請稍後再試')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [])

  return {
    profile, setProfile,
    results, setResults,
    relaxations, setRelaxations,
    loading, error,
    hoveredId, setHoveredId,
    rank,
  }
}
```

- [ ] **Step 6: 實作地圖底圖樣式**

`components/MapView/mapStyle.ts`:
```ts
import type { StyleSpecification } from 'maplibre-gl'

/**
 * OSM 原生 raster 圖磚，無需 API key。
 * 僅適用於 demo 流量；上線需自架圖磚或改用付費供應商（見 spec 風險章節）。
 */
export const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

/** 台北車站，作為無結果時的預設視角 */
export const DEFAULT_CENTER: [number, number] = [121.5170, 25.0478]
export const DEFAULT_ZOOM = 11
```

- [ ] **Step 7: 實作 MapView**

`components/MapView/MapView.tsx`:
```tsx
'use client'

import { useEffect, useRef } from 'react'
// maplibre-gl v6 移除了 default export，只能具名匯入，否則 Turbopack build 會失敗
import {
  Map as MapLibreMapCtor,
  NavigationControl,
  LngLatBounds,
  type GeoJSONSource,
  type Map as MapLibreMap,
} from 'maplibre-gl'
import type { ScoredListing } from '@/lib/types/listing'
import { DEFAULT_CENTER, DEFAULT_ZOOM, OSM_RASTER_STYLE } from './mapStyle'

const SOURCE_ID = 'listings'

interface Props {
  results: ScoredListing[]
  hoveredId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}

// setFeatureState 只認 GeoJSON Feature 頂層的 id（number | string），不是 properties 裡的欄位。
// 這裡以 results 陣列的 index 作為數值型 feature id，hover 時再用同一個 index 對應回去。
function toGeoJson(results: ScoredListing[]) {
  return {
    type: 'FeatureCollection' as const,
    features: results.map((r, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
      properties: { id: r.id, score: r.score, title: r.title },
    })),
  }
}

export function MapView({ results, hoveredId, onHover, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const readyRef = useRef(false)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new MapLibreMapCtor({
      container: containerRef.current,
      style: OSM_RASTER_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')

    // 圖磚載入失敗時降級為灰底，點位仍照常顯示
    map.on('error', (e) => { console.warn('[MapView] 地圖錯誤', e.error) })

    map.on('load', () => {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: toGeoJson([]),
        cluster: true,
        clusterRadius: 45,
        clusterMaxZoom: 13,
      })

      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#1e40af',
          'circle-opacity': 0.85,
          'circle-radius': ['step', ['get', 'point_count'], 16, 5, 22, 15, 28],
        },
      })
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
        paint: { 'text-color': '#ffffff' },
      })
      map.addLayer({
        id: 'points',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          // 分數越高越暖色
          'circle-color': [
            'interpolate', ['linear'], ['get', 'score'],
            0, '#94a3b8', 0.5, '#f59e0b', 0.8, '#dc2626',
          ],
          'circle-radius': ['case', ['boolean', ['feature-state', 'hovered'], false], 12, 8],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })

      map.on('mouseenter', 'points', (e) => {
        map.getCanvas().style.cursor = 'pointer'
        const id = e.features?.[0]?.properties?.id
        if (typeof id === 'string') onHover(id)
      })
      map.on('mouseleave', 'points', () => {
        map.getCanvas().style.cursor = ''
        onHover(null)
      })
      map.on('click', 'points', (e) => {
        const id = e.features?.[0]?.properties?.id
        if (typeof id === 'string') onSelect(id)
      })

      readyRef.current = true
    })

    return () => {
      map.remove()
      mapRef.current = null
      readyRef.current = false
    }
    // onHover / onSelect 以 ref 之外的方式傳入會導致地圖重建，故刻意只在掛載時執行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 結果更新 → 換資料並 fitBounds
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const apply = () => {
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
      if (!source) return
      source.setData(toGeoJson(results))
      if (results.length === 0) return
      const bounds = new LngLatBounds(
        [results[0].lng, results[0].lat],
        [results[0].lng, results[0].lat],
      )
      for (const r of results) bounds.extend([r.lng, r.lat])
      map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 600 })
    }

    if (readyRef.current) apply()
    else map.once('load', apply)
  }, [results])

  // 卡片 hover → marker 放大
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    results.forEach((r, i) => {
      map.setFeatureState(
        { source: SOURCE_ID, id: i },
        { hovered: r.id === hoveredId },
      )
    })
  }, [hoveredId, results])

  return <div ref={containerRef} className="h-full w-full bg-neutral-200" data-testid="map" />
}
```

- [ ] **Step 8: 實作 breakdown 條狀圖**

`components/ListingCard/BreakdownBars.tsx`:
```tsx
import type { ScoredListing } from '@/lib/types/listing'
import { WEIGHT_KEYS, WEIGHT_LABELS } from '@/lib/types/profile'

/** 條狀圖長度以「該維度的貢獻佔總分比例」表示，讓權重的影響直接看得見 */
export function BreakdownBars({ listing }: { listing: ScoredListing }) {
  const total = listing.score || 1
  return (
    <ul className="space-y-1">
      {WEIGHT_KEYS.map((key) => {
        const b = listing.breakdown[key]
        const pct = Math.round((b.contribution / total) * 100)
        return (
          <li key={key} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 text-neutral-500">{WEIGHT_LABELS[key]}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
              <span
                className="block h-full rounded-full bg-blue-600"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="w-8 shrink-0 text-right tabular-nums text-neutral-500">{pct}%</span>
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 9: 實作物件卡片與結果列**

`components/ListingCard/ListingCard.tsx`:
```tsx
import { formatArea, formatCommute, formatDistance, formatPrice } from '@/lib/client/format'
import type { ScoredListing } from '@/lib/types/listing'
import { BreakdownBars } from './BreakdownBars'

interface Props {
  listing: ScoredListing
  rank: number
  hovered: boolean
  onHover: (id: string | null) => void
}

export function ListingCard({ listing, rank, hovered, onHover }: Props) {
  const f = listing.features
  return (
    <article
      onMouseEnter={() => onHover(listing.id)}
      onMouseLeave={() => onHover(null)}
      data-testid="listing-card"
      className={`w-72 shrink-0 rounded-xl border bg-white p-3 transition ${
        hovered ? 'border-blue-500 shadow-lg' : 'border-neutral-200 shadow-sm'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-neutral-400">#{rank}</span>
        <span className="text-xs text-neutral-500">{listing.city}{listing.district}</span>
      </div>

      <h3 className="mt-1 truncate text-sm font-semibold">{listing.title}</h3>
      <p className="mt-1 text-lg font-bold text-blue-700">{formatPrice(listing)}</p>
      <p className="text-xs text-neutral-600">
        {formatArea(listing.area)}・{listing.layout}・屋齡 {listing.age.toFixed(0)} 年・
        {listing.floor}/{listing.totalFloor} 樓
      </p>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-neutral-600">
        <div><dt className="inline text-neutral-400">捷運 </dt><dd className="inline">{formatDistance(f.distToMetro)}</dd></div>
        <div><dt className="inline text-neutral-400">通勤 </dt><dd className="inline">{formatCommute(f.commuteToCbdMin)}</dd></div>
        <div><dt className="inline text-neutral-400">夏均溫 </dt><dd className="inline">{f.summerTemp ?? '—'}°C</dd></div>
        <div><dt className="inline text-neutral-400">雨日 </dt><dd className="inline">{f.rainDays ?? '—'} 天</dd></div>
        <div><dt className="inline text-neutral-400">超商 </dt><dd className="inline">{f.poiConvenience500 ?? '—'} 間</dd></div>
        <div><dt className="inline text-neutral-400">公園 </dt><dd className="inline">{f.poiPark500 ?? '—'} 座</dd></div>
      </dl>

      <div className="mt-3 border-t border-neutral-100 pt-2">
        <BreakdownBars listing={listing} />
      </div>

      {listing.dataGaps.length > 0 && (
        <p className="mt-2 text-[11px] text-amber-700">部分資料不足，已用同區中位數估算</p>
      )}
      <p className="mt-1 text-[11px] text-neutral-400">氣候為區域參考值，通勤為估計值</p>
    </article>
  )
}
```

`components/ListingCard/ResultStrip.tsx`:
```tsx
import type { ScoredListing } from '@/lib/types/listing'
import { ListingCard } from './ListingCard'

interface Props {
  results: ScoredListing[]
  hoveredId: string | null
  onHover: (id: string | null) => void
}

export function ResultStrip({ results, hoveredId, onHover }: Props) {
  if (results.length === 0) {
    return (
      <p className="p-4 text-sm text-neutral-500">
        還沒有結果。描述一下你想要的生活，或直接調整右側的權重。
      </p>
    )
  }
  return (
    <div className="flex h-full gap-3 overflow-x-auto p-3">
      {results.map((r, i) => (
        <ListingCard
          key={r.id}
          listing={r}
          rank={i + 1}
          hovered={r.id === hoveredId}
          onHover={onHover}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 10: 接上主畫面**

`app/page.tsx`:
```tsx
'use client'

import { useEffect } from 'react'
import { MapView } from '@/components/MapView/MapView'
import { ResultStrip } from '@/components/ListingCard/ResultStrip'
import { useSearchState } from '@/hooks/useSearchState'

export default function Home() {
  const s = useSearchState()

  // 首次載入先跑一次預設排序，避免開場空畫面
  useEffect(() => { void s.rank(s.profile) }, [s.profile.mode]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2">
        <h1 className="text-base font-bold">安家</h1>
        <span className="text-xs text-neutral-500">台灣選址助手</span>
        {s.loading && <span className="text-xs text-blue-600">排序中…</span>}
        {s.error && <span className="text-xs text-red-600">{s.error}</span>}
      </header>

      {s.relaxations.length > 0 && (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          為了找到結果，{s.relaxations.join('、')}
        </p>
      )}

      <div className="min-h-0 flex-1">
        <MapView
          results={s.results}
          hoveredId={s.hoveredId}
          onHover={s.setHoveredId}
          onSelect={s.setHoveredId}
        />
      </div>

      <div className="h-64 shrink-0 border-t border-neutral-200 bg-neutral-100">
        <ResultStrip results={s.results} hoveredId={s.hoveredId} onHover={s.setHoveredId} />
      </div>
    </main>
  )
}
```

- [ ] **Step 11: 手動驗證畫面**

```bash
pnpm dev
```
在瀏覽器開 `http://localhost:3000`，確認：
- 地圖載入且顯示台北一帶
- 地圖上有彩色點位與 cluster
- 下方卡片列有物件，含七維條狀圖
- 滑鼠移到卡片上，對應的地圖點位放大

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(ui): MapLibre 地圖、物件卡片與七維 breakdown 條狀圖"
```

---

### Task 6: 權重面板與買賣／租賃切換

**Files:**
- Create: `components/WeightPanel/WeightPanel.tsx`, `components/ModeToggle/ModeToggle.tsx`
- Create: `hooks/useDebouncedEffect.ts`
- Modify: `app/page.tsx`
- Test: `hooks/useDebouncedEffect.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `WEIGHT_KEYS`、`WEIGHT_LABELS`、`SearchProfile`；Task 5 的 `useSearchState`
- Produces:
  - `useDebouncedEffect(fn, deps, delayMs)`
  - `<WeightPanel profile onChange highlighted />` — `highlighted` 為 agent 剛調整過的維度
  - `<ModeToggle mode onChange />`

- [ ] **Step 1: 寫 debounce hook 的失敗測試**

`hooks/useDebouncedEffect.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleDebounced } from './useDebouncedEffect'

describe('scheduleDebounced', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('延遲後才執行', () => {
    const fn = vi.fn()
    scheduleDebounced(fn, 200)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('回傳的 cancel 可取消執行', () => {
    const fn = vi.fn()
    const cancel = scheduleDebounced(fn, 200)
    cancel()
    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()
  })
})
```

> `useDebouncedEffect` 本身是 React hook，需 DOM 環境才能測；此處只單測其純函式核心 `scheduleDebounced`，hook 的行為由 Task 10 的 e2e 覆蓋。

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test hooks/useDebouncedEffect.test.ts`

需先讓 vitest 收錄 `hooks/`：修改 `vitest.config.ts` 的 include 為
```ts
include: ['lib/**/*.test.ts', 'hooks/**/*.test.ts'],
```

Expected: FAIL — `Failed to resolve import "./useDebouncedEffect"`

- [ ] **Step 3: 實作 debounce hook**

`hooks/useDebouncedEffect.ts`:
```ts
'use client'

import { useEffect, type DependencyList } from 'react'

/** 純函式核心，可單元測試 */
export function scheduleDebounced(fn: () => void, delayMs: number): () => void {
  const timer = setTimeout(fn, delayMs)
  return () => clearTimeout(timer)
}

/** deps 變動後延遲 delayMs 才執行；期間再次變動會重新計時 */
export function useDebouncedEffect(
  fn: () => void,
  deps: DependencyList,
  delayMs: number,
): void {
  useEffect(() => scheduleDebounced(fn, delayMs), [...deps, delayMs]) // eslint-disable-line react-hooks/exhaustive-deps
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm test hooks/useDebouncedEffect.test.ts`
Expected: PASS（2 個測試）

- [ ] **Step 5: 實作權重面板**

`components/WeightPanel/WeightPanel.tsx`:
```tsx
'use client'

import * as Slider from '@radix-ui/react-slider'
import { DEFAULT_PROFILE, WEIGHT_KEYS, WEIGHT_LABELS, type SearchProfile, type WeightKey } from '@/lib/types/profile'

interface Props {
  profile: SearchProfile
  onChange: (next: SearchProfile) => void
  /** agent 剛調整過的維度 → 顯示變化並高亮 */
  highlighted: Partial<Record<WeightKey, { from: number; to: number }>>
}

export function WeightPanel({ profile, onChange, highlighted }: Props) {
  const setWeight = (key: WeightKey, value: number) => {
    onChange({ ...profile, weights: { ...profile.weights, [key]: value } })
  }

  return (
    <section className="border-t border-neutral-200 bg-white p-3" data-testid="weight-panel">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">權重</h2>
        <button
          type="button"
          onClick={() => onChange({ ...profile, weights: { ...DEFAULT_PROFILE.weights } })}
          className="text-xs text-neutral-500 underline hover:text-neutral-800"
        >
          重設
        </button>
      </div>

      <ul className="space-y-2.5">
        {WEIGHT_KEYS.map((key) => {
          const change = highlighted[key]
          return (
            <li key={key}>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="text-neutral-700">{WEIGHT_LABELS[key]}</span>
                {change ? (
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-800 tabular-nums">
                    {change.from} → {change.to}
                  </span>
                ) : (
                  <span className="tabular-nums text-neutral-400">{profile.weights[key]}</span>
                )}
              </div>
              <Slider.Root
                className="relative flex h-4 w-full touch-none items-center"
                value={[profile.weights[key]]}
                min={0}
                max={100}
                step={1}
                aria-label={WEIGHT_LABELS[key]}
                onValueChange={([v]) => setWeight(key, v)}
              >
                <Slider.Track className="relative h-1 w-full grow rounded-full bg-neutral-200">
                  <Slider.Range className="absolute h-full rounded-full bg-blue-600" />
                </Slider.Track>
                <Slider.Thumb className="block h-3.5 w-3.5 rounded-full border-2 border-blue-600 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400" />
              </Slider.Root>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
```

- [ ] **Step 6: 實作買賣／租賃切換**

`components/ModeToggle/ModeToggle.tsx`:
```tsx
'use client'

import type { Mode } from '@/lib/types/profile'

const OPTIONS: Array<{ value: Mode; label: string }> = [
  { value: 'sale', label: '買房' },
  { value: 'rent', label: '租房' },
]

export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-neutral-300 p-0.5" role="group" aria-label="買賣或租賃">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={mode === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition ${
            mode === o.value ? 'bg-blue-600 text-white' : 'text-neutral-600 hover:bg-neutral-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 7: 把面板接上主畫面（拖動即時重排，不呼叫 Gemini）**

`app/page.tsx` — 改為左右分欄，左欄放權重面板：
```tsx
'use client'

import { useEffect, useState } from 'react'
import { MapView } from '@/components/MapView/MapView'
import { ModeToggle } from '@/components/ModeToggle/ModeToggle'
import { ResultStrip } from '@/components/ListingCard/ResultStrip'
import { WeightPanel } from '@/components/WeightPanel/WeightPanel'
import { useDebouncedEffect } from '@/hooks/useDebouncedEffect'
import { useSearchState } from '@/hooks/useSearchState'
import type { Mode, WeightKey } from '@/lib/types/profile'

const RANK_DEBOUNCE_MS = 200

export default function Home() {
  const s = useSearchState()
  const [highlighted] = useState<Partial<Record<WeightKey, { from: number; to: number }>>>({})

  // profile 任何變動（含 slider 拖動）都在 debounce 後重新排序；此路徑不呼叫 Gemini
  useDebouncedEffect(() => { void s.rank(s.profile) }, [s.profile], RANK_DEBOUNCE_MS)

  const setMode = (mode: Mode) => {
    // 買賣與租賃的預算量級不同，切換時一併清掉
    const { budgetMin: _min, budgetMax: _max, ...hard } = s.profile.hard
    s.setProfile({ ...s.profile, mode, hard })
  }

  return (
    <main className="flex h-screen">
      <aside className="flex w-[360px] shrink-0 flex-col border-r border-neutral-200 bg-white">
        <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3">
          <h1 className="text-base font-bold">安家</h1>
          <ModeToggle mode={s.profile.mode} onChange={setMode} />
        </header>
        <div className="flex-1 overflow-y-auto">
          <WeightPanel profile={s.profile} onChange={s.setProfile} highlighted={highlighted} />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2 text-xs">
          <span className="text-neutral-500">找到 {s.results.length} 筆</span>
          {s.loading && <span className="text-blue-600">排序中…</span>}
          {s.error && <span className="text-red-600">{s.error}</span>}
        </div>

        {s.relaxations.length > 0 && (
          <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            為了找到結果，{s.relaxations.join('、')}
          </p>
        )}

        <div className="min-h-0 flex-1">
          <MapView results={s.results} hoveredId={s.hoveredId} onHover={s.setHoveredId} onSelect={s.setHoveredId} />
        </div>

        <div className="h-64 shrink-0 border-t border-neutral-200 bg-neutral-100">
          <ResultStrip results={s.results} hoveredId={s.hoveredId} onHover={s.setHoveredId} />
        </div>
      </section>
    </main>
  )
}
```

`useSearchState` 的首次載入 effect 已由 `useDebouncedEffect` 取代，移除 Task 5 Step 10 的 `useEffect` 版本。

- [ ] **Step 8: 手動驗證**

```bash
pnpm dev
```
確認：
- 拖動「房屋價位」到 100、其餘拉低 → 卡片重排為單價較低的物件，約 200ms 內完成
- 切到「租房」→ 結果換成租賃物件，價格顯示為「元/月」
- 按「重設」→ 七條回到 50

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(ui): 權重面板即時重排與買賣／租賃切換"
```

---

### Task 7: Gemini 萃取層

**Files:**
- Create: `lib/agent/prompts.ts`, `lib/agent/tools.ts`, `lib/agent/client.ts`, `lib/agent/extract.ts`, `lib/agent/explain.ts`
- Create: `lib/types/chat.ts`
- Test: `lib/agent/extract.test.ts`, `lib/agent/explain.test.ts`
- Create: `.env.local`（不進 git）

**Interfaces:**
- Consumes: Task 4 的 `profileDeltaSchema`、`ProfileDelta`；Task 1 的 `SearchProfile`、`ScoredListing`
- Produces:
  - `ChatMessage { role: 'user' | 'assistant'; content: string }`
  - `UPDATE_PROFILE_DECLARATION`（Gemini function declaration）
  - `parseFunctionCall(args: unknown): ProfileDelta`（純函式）
  - `buildContents(messages: ChatMessage[], profile: SearchProfile)`（純函式）
  - `extractDelta(messages, profile): Promise<ProfileDelta>`（失敗回 `{}`，不拋錯）
  - `buildExplainPrompt(profile, results, relaxations): string`（純函式）
  - `streamExplanation(prompt): AsyncIterable<string>`

- [ ] **Step 1: 定義聊天型別與環境變數**

`lib/types/chat.ts`:
```ts
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}
```

`.env.local`（自行填入金鑰，此檔已在 `.gitignore`）：
```
GEMINI_API_KEY=你的金鑰
GEMINI_MODEL=gemini-3.7-flash
```

- [ ] **Step 2: 寫 system prompt**

`lib/agent/prompts.ts`:
```ts
export const EXTRACT_SYSTEM_PROMPT = `你是台灣房屋選址助理的「條件萃取器」。你唯一的工作是呼叫 update_search_profile，把使用者這次的發言轉成條件與權重的「變動量」。

必須遵守的四條規則：

1. 增量，不重寫。只回報使用者這次提到的變動。使用者說「我更在乎交通」，就只回 weightsDelta: { location: 20 }，其他維度一律不填。
2. hard 條件要保守。只有使用者講出明確數字或明確地名時才填 hard。像「不要太貴」這種模糊說法，改成 weightsDelta: { price: 15 }，絕對不要設 budgetMax。誤設 hard 條件會讓結果變成 0 筆。
3. 沒講的絕不編造。使用者沒提到的偏好一律不填。
4. 單位要正確。買賣的 budgetMax 單位是「萬元總價」（1500 萬 → 1500）；租賃的 budgetMax 單位是「元／月」（2 萬 → 20000）。坪數單位是坪，距離單位是公尺。

七個權重維度的意義：
- price 房價可負擔（跨行政區的絕對單價水準，越低越高分）
- value 同區性價比（同區同型態內相對越便宜越高分）
- weather 天氣環境（溫度、降雨、濕度、空氣品質）
- location 地理位置（離軌道運輸的距離、到通勤錨點的時間）
- amenities 生活機能（超商、超市、公園、醫院、學校、餐飲的密度）
- space 坪數格局
- quality 屋況（屋齡、樓層、電梯、車位、安靜程度）

weightsDelta 的合理幅度是 10 到 30；語氣強烈（「最重要」「絕對不能」）時才用 40 以上。

使用者提到「我在某地上班／上學」時，填 soft.commuteAnchor，並附上該地點的經緯度與 label。只填台灣的座標。

note 欄位用一句話記下使用者這次的口語脈絡，供之後解釋時引用。`

export const EXPLAIN_SYSTEM_PROMPT = `你是台灣房屋選址助理。你會拿到使用者目前的條件與排序後的前幾筆物件，要用繁體中文寫 2 到 4 句話的說明。

規則：
- 必須講取捨，不能只講優點。例如「這幾筆總價都在你的預算內，代價是屋齡普遍超過 30 年、而且沒有電梯」。
- 如果有「已放寬的條件」，必須明講放寬了什麼，不可略過。
- 如果有資料不足的欄位，簡短提一句這些數字是估算的。
- 最後一定要主動提出一個可以調整的方向，並以問句結尾，例如「要我把屋齡的權重拉高再看一次嗎？」
- 不要條列，寫成自然的段落。不要重複列出物件清單，使用者已經看得到卡片。
- 不要杜撰任何沒有出現在資料裡的數字。`
```

- [ ] **Step 3: 寫 function declaration**

`lib/agent/tools.ts`:
```ts
import { Type, type FunctionDeclaration } from '@google/genai'

export const UPDATE_PROFILE_FUNCTION_NAME = 'update_search_profile'

export const UPDATE_PROFILE_DECLARATION: FunctionDeclaration = {
  name: UPDATE_PROFILE_FUNCTION_NAME,
  description: '把使用者這次發言中的找房條件與權重「變動量」寫入。未提到的欄位一律省略。',
  parameters: {
    type: Type.OBJECT,
    properties: {
      mode: {
        type: Type.STRING,
        enum: ['sale', 'rent'],
        description: '使用者明確表示要買房或租房時才填',
      },
      weightsDelta: {
        type: Type.OBJECT,
        description: '各維度權重的增減，範圍 -100 到 100，一般用 10 到 30',
        properties: {
          price: { type: Type.NUMBER },
          weather: { type: Type.NUMBER },
          location: { type: Type.NUMBER },
          amenities: { type: Type.NUMBER },
          space: { type: Type.NUMBER },
          quality: { type: Type.NUMBER },
        },
      },
      hard: {
        type: Type.OBJECT,
        description: '硬性條件。只有使用者講出明確數字或地名時才填。',
        properties: {
          cities: { type: Type.ARRAY, items: { type: Type.STRING }, description: '例：臺北市、新北市' },
          districts: { type: Type.ARRAY, items: { type: Type.STRING }, description: '例：大安區、板橋區' },
          budgetMin: { type: Type.NUMBER, description: '買賣為萬元總價，租賃為元／月' },
          budgetMax: { type: Type.NUMBER, description: '買賣為萬元總價，租賃為元／月' },
          minArea: { type: Type.NUMBER, description: '最小坪數' },
          minRooms: { type: Type.NUMBER, description: '最少房間數' },
          maxAge: { type: Type.NUMBER, description: '屋齡上限，單位年' },
          buildingTypes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '電梯大樓、公寓、華廈、透天厝、套房',
          },
          needElevator: { type: Type.BOOLEAN },
          needParking: { type: Type.BOOLEAN },
          maxDistToMetro: { type: Type.NUMBER, description: '離捷運距離上限，單位公尺' },
        },
      },
      soft: {
        type: Type.OBJECT,
        description: '軟性偏好，只調整分數不排除物件',
        properties: {
          prefersCool: { type: Type.BOOLEAN, description: '怕熱' },
          prefersLowRain: { type: Type.BOOLEAN, description: '討厭多雨' },
          prefersQuiet: { type: Type.NUMBER, description: '-1 到 1，正值偏好安靜' },
          commuteAnchor: {
            type: Type.OBJECT,
            description: '使用者上班或上學的地點',
            properties: {
              lat: { type: Type.NUMBER },
              lng: { type: Type.NUMBER },
              label: { type: Type.STRING },
              maxMin: { type: Type.NUMBER, description: '可接受的通勤分鐘數' },
            },
            required: ['lat', 'lng', 'label'],
          },
        },
      },
      note: { type: Type.STRING, description: '用一句話記下使用者這次的口語脈絡' },
    },
  },
}
```

- [ ] **Step 4: 寫萃取層的失敗測試**

`lib/agent/extract.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { buildContents, parseFunctionCall } from './extract'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'

const profile = (o: Partial<SearchProfile> = {}): SearchProfile => ({ ...DEFAULT_PROFILE, ...o })

describe('parseFunctionCall', () => {
  it('解析合法的權重變動', () => {
    expect(parseFunctionCall({ weightsDelta: { location: 20 } })).toEqual({ weightsDelta: { location: 20 } })
  })

  it('丟棄未知欄位，保留合法欄位', () => {
    const d = parseFunctionCall({ weightsDelta: { price: 15 }, 幻覺欄位: '亂寫' })
    expect(d.weightsDelta).toEqual({ price: 15 })
    expect(d).not.toHaveProperty('幻覺欄位')
  })

  it('權重超出範圍時 clamp 而非整包失敗', () => {
    expect(parseFunctionCall({ weightsDelta: { price: 9999 } }).weightsDelta?.price).toBe(100)
  })

  it('台灣範圍外的 commuteAnchor 被丟棄，其餘 soft 偏好保留', () => {
    const d = parseFunctionCall({
      soft: { prefersCool: true, commuteAnchor: { lat: 48.8, lng: 2.3, label: '巴黎' } },
    })
    expect(d.soft?.prefersCool).toBe(true)
    expect(d.soft?.commuteAnchor).toBeUndefined()
  })

  it('完全不合法的輸入回空 delta，不拋錯', () => {
    expect(parseFunctionCall('垃圾')).toEqual({})
    expect(parseFunctionCall(null)).toEqual({})
    expect(parseFunctionCall(undefined)).toEqual({})
  })

  it('接受完整的一次萃取', () => {
    const d = parseFunctionCall({
      mode: 'rent',
      weightsDelta: { location: 25, price: 10 },
      hard: { budgetMax: 25000, minRooms: 2 },
      soft: { prefersQuiet: 1, commuteAnchor: { lat: 25.033, lng: 121.565, label: '信義區', maxMin: 40 } },
      note: '在信義區上班，想安靜一點',
    })
    expect(d.mode).toBe('rent')
    expect(d.hard?.budgetMax).toBe(25000)
    expect(d.soft?.commuteAnchor?.label).toBe('信義區')
    expect(d.note).toContain('信義區')
  })
})

describe('buildContents', () => {
  it('把對話轉成 Gemini 的 contents 格式', () => {
    const contents = buildContents(
      [{ role: 'user', content: '我想找台北的房子' }],
      profile(),
    )
    expect(contents.at(-1)?.role).toBe('user')
    expect(JSON.stringify(contents)).toContain('我想找台北的房子')
  })

  it('assistant 角色轉為 model', () => {
    const contents = buildContents(
      [{ role: 'user', content: '你好' }, { role: 'assistant', content: '哈囉' }, { role: 'user', content: '繼續' }],
      profile(),
    )
    expect(contents[1].role).toBe('model')
  })

  it('只保留最近 6 輪對話', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as const,
      content: `訊息${i}`,
    }))
    const contents = buildContents(many, profile())
    expect(contents.length).toBeLessThanOrEqual(13) // 12 則對話 + 1 則現況說明
    expect(JSON.stringify(contents)).not.toContain('訊息0')
  })

  it('把目前的 profile 現況帶進去，讓模型知道要做增量', () => {
    const contents = buildContents(
      [{ role: 'user', content: '再便宜一點' }],
      profile({ weights: { ...DEFAULT_PROFILE.weights, price: 80 } }),
    )
    expect(JSON.stringify(contents)).toContain('80')
  })

  it('空對話仍回傳含現況的 contents', () => {
    expect(buildContents([], profile()).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 5: 執行測試確認失敗**

Run: `pnpm test lib/agent/extract.test.ts`
Expected: FAIL — `Failed to resolve import "./extract"`

- [ ] **Step 6: 實作 Gemini client 與萃取層**

`lib/agent/client.ts`:
```ts
import 'server-only'
import { GoogleGenAI } from '@google/genai'

/** 2026-08 查證：Flash 系列最新穩定版。禁止改回 gemini-2.5-flash（2026-10-16 停用）。 */
export const DEFAULT_MODEL = 'gemini-3.7-flash'

let cached: GoogleGenAI | null = null

export function getGenAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY 未設定')
  if (!cached) cached = new GoogleGenAI({ apiKey })
  return cached
}

export function getModel(): string {
  return process.env.GEMINI_MODEL ?? DEFAULT_MODEL
}
```

`lib/agent/extract.ts`:
```ts
import type { Content } from '@google/genai'
import { profileDeltaSchema } from '@/lib/profile/schema'
import type { ProfileDelta } from '@/lib/profile/merge'
import type { ChatMessage } from '@/lib/types/chat'
import type { SearchProfile } from '@/lib/types/profile'
import { getGenAI, getModel } from './client'
import { EXTRACT_SYSTEM_PROMPT } from './prompts'
import { UPDATE_PROFILE_DECLARATION, UPDATE_PROFILE_FUNCTION_NAME } from './tools'

/** 只送最近 6 輪（12 則）以控制 token */
const MAX_TURNS = 6

/** 驗證模型輸出。任何不合法內容都被丟棄，絕不讓單一幻覺欄位炸掉整包。 */
export function parseFunctionCall(args: unknown): ProfileDelta {
  const parsed = profileDeltaSchema.safeParse(args)
  return parsed.success ? (parsed.data as ProfileDelta) : {}
}

export function buildContents(messages: ChatMessage[], profile: SearchProfile): Content[] {
  const recent = messages.slice(-MAX_TURNS * 2)
  const state: Content = {
    role: 'user',
    parts: [{
      text: `［目前條件現況，僅供你判斷要做哪些增量，不要重複設定］\n${JSON.stringify({
        mode: profile.mode,
        weights: profile.weights,
        hard: profile.hard,
        soft: profile.soft,
      })}`,
    }],
  }
  return [
    state,
    ...recent.map((m): Content => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
  ]
}

/** 呼叫 Gemini 萃取變動量。任何失敗都回空 delta，讓上層沿用原條件照樣排序。 */
export async function extractDelta(
  messages: ChatMessage[],
  profile: SearchProfile,
): Promise<ProfileDelta> {
  try {
    const response = await getGenAI().models.generateContent({
      model: getModel(),
      contents: buildContents(messages, profile),
      config: {
        systemInstruction: EXTRACT_SYSTEM_PROMPT,
        temperature: 0,
        tools: [{ functionDeclarations: [UPDATE_PROFILE_DECLARATION] }],
        toolConfig: {
          functionCallingConfig: {
            mode: 'ANY',
            allowedFunctionNames: [UPDATE_PROFILE_FUNCTION_NAME],
          },
        },
      },
    })
    const call = response.functionCalls?.find((c) => c.name === UPDATE_PROFILE_FUNCTION_NAME)
    return parseFunctionCall(call?.args)
  } catch (error) {
    console.error('[agent/extract] 萃取失敗，沿用原條件', error)
    return {}
  }
}
```

- [ ] **Step 7: 執行測試確認通過**

Run: `pnpm test lib/agent/extract.test.ts`
Expected: PASS（11 個測試）

- [ ] **Step 8: 寫解釋層的失敗測試**

`lib/agent/explain.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { buildExplainPrompt } from './explain'
import { makeListing } from '@/lib/test-utils/factory'
import { DEFAULT_PROFILE } from '@/lib/types/profile'
import type { ScoredListing } from '@/lib/types/listing'

const scored = (o: Partial<ScoredListing> = {}): ScoredListing => ({
  ...makeListing(),
  score: 0.7,
  breakdown: {
    price: { subscore: 0.8, weight: 0.2, contribution: 0.16 },
    weather: { subscore: 0.5, weight: 0.15, contribution: 0.075 },
    location: { subscore: 0.6, weight: 0.2, contribution: 0.12 },
    amenities: { subscore: 0.7, weight: 0.2, contribution: 0.14 },
    space: { subscore: 0.6, weight: 0.15, contribution: 0.09 },
    quality: { subscore: 0.5, weight: 0.1, contribution: 0.05 },
  },
  dataGaps: [],
  ...o,
})

describe('buildExplainPrompt', () => {
  it('包含前幾筆物件的關鍵欄位', () => {
    const p = buildExplainPrompt(DEFAULT_PROFILE, [scored({ district: '大安區', age: 32 })], [])
    expect(p).toContain('大安區')
    expect(p).toContain('32')
  })

  it('最多帶 5 筆物件，避免 prompt 過長', () => {
    const many = Array.from({ length: 30 }, (_, i) => scored({ id: `L${i}`, title: `物件${i}` }))
    const p = buildExplainPrompt(DEFAULT_PROFILE, many, [])
    expect(p).toContain('物件4')
    expect(p).not.toContain('物件5')
  })

  it('有放寬條件時明列出來', () => {
    const p = buildExplainPrompt(DEFAULT_PROFILE, [scored()], ['把預算上限放寬到 1150'])
    expect(p).toContain('已放寬的條件')
    expect(p).toContain('1150')
  })

  it('有資料缺口時列出來', () => {
    const p = buildExplainPrompt(DEFAULT_PROFILE, [scored({ dataGaps: ['aqiMean'] })], [])
    expect(p).toContain('aqiMean')
  })

  it('0 筆結果時要求模型說明並提出放寬建議', () => {
    const p = buildExplainPrompt(DEFAULT_PROFILE, [], ['放寬所有條件後仍找不到符合的物件'])
    expect(p).toContain('沒有找到')
  })

  it('帶入目前的權重，讓解釋能對應權重', () => {
    const p = buildExplainPrompt({ ...DEFAULT_PROFILE, weights: { ...DEFAULT_PROFILE.weights, price: 90 } }, [scored()], [])
    expect(p).toContain('90')
  })
})
```

- [ ] **Step 9: 執行測試確認失敗**

Run: `pnpm test lib/agent/explain.test.ts`
Expected: FAIL — `Failed to resolve import "./explain"`

- [ ] **Step 10: 實作解釋層**

`lib/agent/explain.ts`:
```ts
import type { ScoredListing } from '@/lib/types/listing'
import type { SearchProfile } from '@/lib/types/profile'
import { getGenAI, getModel } from './client'
import { EXPLAIN_SYSTEM_PROMPT } from './prompts'

/** 只帶前 5 筆進 prompt，其餘卡片使用者自己看得到 */
const EXPLAIN_TOP_N = 5

export function buildExplainPrompt(
  profile: SearchProfile,
  results: ScoredListing[],
  relaxations: string[],
): string {
  const sections: string[] = [
    `［使用者目前的權重］\n${JSON.stringify(profile.weights)}`,
    `［硬性條件］\n${JSON.stringify(profile.hard)}`,
    `［軟性偏好］\n${JSON.stringify(profile.soft)}`,
  ]

  if (profile.notes.length > 0) {
    sections.push(`［使用者說過的話］\n${profile.notes.join('\n')}`)
  }

  if (results.length === 0) {
    sections.push('［排序結果］\n沒有找到任何符合的物件。請說明可能的原因，並具體建議使用者可以放寬哪一項條件。')
  } else {
    const top = results.slice(0, EXPLAIN_TOP_N).map((r, i) => {
      const f = r.features
      return [
        `${i + 1}. ${r.city}${r.district}｜${r.title}`,
        `   價格 ${r.price}（${r.mode === 'sale' ? '萬元總價' : '元每月'}）｜${r.area} 坪｜${r.layout}｜屋齡 ${r.age} 年｜${r.floor}/${r.totalFloor} 樓｜${r.buildingType}`,
        `   離捷運 ${f.distToMetro ?? '不明'} 公尺｜估計通勤 ${f.commuteToCbdMin ?? '不明'} 分鐘`,
        `   夏均溫 ${f.summerTemp ?? '不明'}°C｜年雨日 ${f.rainDays ?? '不明'} 天｜AQI ${f.aqiMean ?? '不明'}`,
        `   500 公尺內：超商 ${f.poiConvenience500 ?? '不明'}、超市 ${f.poiSupermarket500 ?? '不明'}、公園 ${f.poiPark500 ?? '不明'}`,
        `   各維度貢獻 ${JSON.stringify(
          Object.fromEntries(Object.entries(r.breakdown).map(([k, v]) => [k, Number(v.contribution.toFixed(3))])),
        )}`,
        r.dataGaps.length > 0 ? `   資料不足的欄位：${r.dataGaps.join('、')}` : '',
      ].filter(Boolean).join('\n')
    })
    sections.push(`［排序結果前 ${top.length} 筆］\n${top.join('\n')}`)
  }

  if (relaxations.length > 0) {
    sections.push(`［已放寬的條件，必須在回覆中明講］\n${relaxations.join('\n')}`)
  }

  return sections.join('\n\n')
}

/** 串流解釋文字。呼叫端負責處理錯誤（見 /api/chat 的降級路徑）。 */
export async function* streamExplanation(prompt: string): AsyncGenerator<string> {
  const stream = await getGenAI().models.generateContentStream({
    model: getModel(),
    contents: prompt,
    config: {
      systemInstruction: EXPLAIN_SYSTEM_PROMPT,
      temperature: 0.6,
    },
  })
  for await (const chunk of stream) {
    const text = chunk.text
    if (text) yield text
  }
}
```

- [ ] **Step 11: 執行測試確認通過**

Run: `pnpm test`
Expected: PASS（先前 93 + extract 11 + explain 6 = 110 個測試）

累計對照：geo 4 + normalize 5 + gaps 5 + dimensions 16 + filter 7 + index 15 + relax 7
+ merge 13 + schema 11 + format 8 + debounce 2 = 93

- [ ] **Step 12: 加入萃取的整合測試（預設 skip，需 API key）**

spec §9 要求以中文語句 fixture 驗證真實的 tool call。這類測試會產生費用，因此預設跳過。

`lib/agent/extract.integration.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { extractDelta } from './extract'
import { DEFAULT_PROFILE } from '@/lib/types/profile'

// 需要真實金鑰，會產生費用。執行方式：
//   RUN_LLM_TESTS=1 pnpm vitest run lib/agent/extract.integration.test.ts
const maybe = process.env.RUN_LLM_TESTS && process.env.GEMINI_API_KEY ? describe : describe.skip

maybe('extractDelta（真實呼叫 Gemini）', () => {
  it('把明確的預算數字寫進 hard.budgetMax', async () => {
    const d = await extractDelta(
      [{ role: 'user', content: '我想在台北買房，總價 1500 萬以內' }],
      DEFAULT_PROFILE,
    )
    expect(d.hard?.budgetMax).toBe(1500)
  }, 30_000)

  it('模糊的「不要太貴」不設 budgetMax，改為提高 price 權重', async () => {
    const d = await extractDelta(
      [{ role: 'user', content: '想找不要太貴的房子' }],
      DEFAULT_PROFILE,
    )
    expect(d.hard?.budgetMax).toBeUndefined()
    expect(d.weightsDelta?.price ?? 0).toBeGreaterThan(0)
  }, 30_000)

  it('「我更在乎交通」只調整 location，不動其他維度', async () => {
    const d = await extractDelta(
      [{ role: 'user', content: '我更在乎交通方便' }],
      DEFAULT_PROFILE,
    )
    expect(d.weightsDelta?.location ?? 0).toBeGreaterThan(0)
    expect(Object.keys(d.weightsDelta ?? {})).toEqual(['location'])
  }, 30_000)

  it('「我在信義區上班」寫成 commuteAnchor', async () => {
    const d = await extractDelta(
      [{ role: 'user', content: '我在信義區上班，通勤希望半小時內' }],
      DEFAULT_PROFILE,
    )
    expect(d.soft?.commuteAnchor).toBeDefined()
    expect(d.soft?.commuteAnchor?.lat).toBeGreaterThan(24)
    expect(d.soft?.commuteAnchor?.lat).toBeLessThan(26)
  }, 30_000)
})
```

`vitest.config.ts` 的 include 已涵蓋 `lib/**/*.test.ts`，此檔會被收錄但預設整組 skip。

驗證 skip 生效：
```bash
pnpm test lib/agent/extract.integration.test.ts
```
Expected: 4 個測試顯示為 skipped，`pnpm test` 總數仍為 110 passed

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(agent): Gemini 條件萃取與結果解釋層"
```

---

### Task 8: /api/chat SSE 端點

**Files:**
- Create: `lib/sse.ts`, `app/api/chat/route.ts`
- Test: `lib/sse.test.ts`

**Interfaces:**
- Consumes: Task 7 的 `extractDelta`、`buildExplainPrompt`、`streamExplanation`；Task 4 的 `mergeProfile`、`parseProfile`；Task 3 的 `rankWithRelaxation`；Task 1 的 `loadPool`
- Produces:
  - `sseEvent(event: string, data: unknown): string`
  - `POST /api/chat` — SSE，依序送出 `profile` → `results` → `text`(多次) → `done`

- [ ] **Step 1: 寫 SSE 編碼的失敗測試**

`lib/sse.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { sseEvent } from './sse'

describe('sseEvent', () => {
  it('產生合法的 SSE 區塊', () => {
    expect(sseEvent('ping', { a: 1 })).toBe('event: ping\ndata: {"a":1}\n\n')
  })

  it('字串內的換行不會破壞協定', () => {
    const out = sseEvent('text', { delta: '第一行\n第二行' })
    // JSON 序列化會把換行轉成 \\n，data 行必須維持單行
    expect(out.split('\n').filter((l) => l.startsWith('data: '))).toHaveLength(1)
  })

  it('中文不被轉義成 unicode 逃脫字元', () => {
    expect(sseEvent('text', { delta: '大安區' })).toContain('大安區')
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test lib/sse.test.ts`
Expected: FAIL — `Failed to resolve import "./sse"`

- [ ] **Step 3: 實作 SSE 編碼**

`lib/sse.ts`:
```ts
/** JSON.stringify 會把換行轉成 \n 逃脫字元，因此 data 恆為單行，符合 SSE 協定 */
export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm test lib/sse.test.ts`
Expected: PASS（3 個測試）

- [ ] **Step 5: 實作 /api/chat**

`app/api/chat/route.ts`:
```ts
import { buildExplainPrompt, streamExplanation } from '@/lib/agent/explain'
import { extractDelta } from '@/lib/agent/extract'
import { loadPool } from '@/lib/db/client'
import { mergeProfile } from '@/lib/profile/merge'
import { parseProfile } from '@/lib/profile/schema'
import { rankWithRelaxation } from '@/lib/scoring/relax'
import { sseEvent } from '@/lib/sse'
import type { ChatMessage } from '@/lib/types/chat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FALLBACK_TEXT = '我沒有完全聽懂，先用原本的條件給你結果。可以再說得具體一點，例如預算、上班地點，或你最在意哪一項。'

function parseMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((m): m is ChatMessage =>
      typeof m === 'object' && m !== null &&
      (m as ChatMessage).role !== undefined &&
      typeof (m as ChatMessage).content === 'string')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content.slice(0, 2000),
    }))
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('請求格式錯誤', { status: 400 })
  }

  const raw = body as { profile?: unknown; messages?: unknown } | null
  const currentProfile = parseProfile(raw?.profile)
  const messages = parseMessages(raw?.messages)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)))
      }

      try {
        // 1. 萃取。失敗時 extractDelta 已回空 delta，流程照常往下走。
        const delta = await extractDelta(messages, currentProfile)
        const extractionFailed = Object.keys(delta).length === 0
        const profile = mergeProfile(currentProfile, delta)
        send('profile', profile)

        // 2. 排序。資料庫問題才是真正的致命錯誤。
        const pool = loadPool(profile.mode, profile.hard.cities)
        const ranked = rankWithRelaxation(profile, pool)
        send('results', ranked)

        // 3. 解釋。串流失敗就退回固定文案，永不留白畫面。
        try {
          const prompt = buildExplainPrompt(profile, ranked.results, ranked.relaxations)
          let emitted = false
          for await (const chunk of streamExplanation(prompt)) {
            emitted = true
            send('text', { delta: chunk })
          }
          if (!emitted) send('text', { delta: FALLBACK_TEXT })
        } catch (error) {
          console.error('[api/chat] 解釋串流失敗', error)
          send('text', {
            delta: extractionFailed
              ? FALLBACK_TEXT
              : '結果已更新，不過我這次沒辦法寫出說明。你可以直接看地圖與卡片，或調整左邊的權重。',
          })
        }

        send('done', {})
      } catch (error) {
        console.error('[api/chat] 處理失敗', error)
        send('error', { message: '伺服器忙碌中，請稍後再試。你仍然可以直接調整權重來重新排序。' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
```

- [ ] **Step 6: 手動驗證 SSE**

```bash
pnpm dev &
sleep 5
curl -N -X POST http://localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{"profile":{"mode":"sale","weights":{"price":50,"weather":50,"location":50,"amenities":50,"space":50,"quality":50},"hard":{},"soft":{},"notes":[]},"messages":[{"role":"user","content":"我在信義區上班，預算 2000 萬以內，想要安靜、生活機能好"}]}'
```
Expected: 依序出現 `event: profile`（`hard.budgetMax` 應為 2000、`soft.commuteAnchor` 應為信義區座標）、`event: results`、多筆 `event: text`、最後 `event: done`

無金鑰時的降級驗證：
```bash
GEMINI_API_KEY= pnpm dev
```
重跑上面的 curl → 仍應收到 `profile`、`results` 與一段 `text` 降級文案，**不可**出現空回應或 500

驗證完關閉：`kill %1`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): /api/chat SSE 端點，含萃取失敗與串流失敗的降級路徑"
```

---

### Task 9: 對話介面與初始畫面

**Files:**
- Create: `lib/client/sseClient.ts`, `lib/client/placeholders.ts`
- Create: `hooks/useChat.ts`
- Create: `components/Chat/ChatPanel.tsx`, `components/Chat/Composer.tsx`, `components/Chat/Landing.tsx`
- Modify: `app/page.tsx`
- Test: `lib/client/sseClient.test.ts`

**Interfaces:**
- Consumes: Task 8 的 `POST /api/chat`；Task 5 的 `useSearchState`；Task 6 的 `WeightPanel` 的 `highlighted`
- Produces:
  - `parseSseChunk(buffer: string): { events: Array<{ event: string; data: unknown }>; rest: string }`（純函式）
  - `PLACEHOLDERS: string[]`
  - `useChat(searchState)` → `{ messages, streaming, send, highlighted }`
  - `<Landing onSubmit mode onModeChange />`、`<ChatPanel ... />`

- [ ] **Step 1: 寫 SSE 解析的失敗測試**

`lib/client/sseClient.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseSseChunk } from './sseClient'

describe('parseSseChunk', () => {
  it('解析完整的單一事件', () => {
    const { events, rest } = parseSseChunk('event: text\ndata: {"delta":"哈囉"}\n\n')
    expect(events).toEqual([{ event: 'text', data: { delta: '哈囉' } }])
    expect(rest).toBe('')
  })

  it('解析同一批的多個事件', () => {
    const raw = 'event: profile\ndata: {"mode":"sale"}\n\nevent: done\ndata: {}\n\n'
    expect(parseSseChunk(raw).events.map((e) => e.event)).toEqual(['profile', 'done'])
  })

  it('不完整的事件留在 rest 等待下一段', () => {
    const { events, rest } = parseSseChunk('event: text\ndata: {"delta":"半')
    expect(events).toEqual([])
    expect(rest).toBe('event: text\ndata: {"delta":"半')
  })

  it('跨批次拼接後可正確解析', () => {
    const first = parseSseChunk('event: text\ndata: {"del')
    const second = parseSseChunk(first.rest + 'ta":"完整"}\n\n')
    expect(second.events).toEqual([{ event: 'text', data: { delta: '完整' } }])
  })

  it('data 不是合法 JSON 時跳過該事件而非整包失敗', () => {
    const { events } = parseSseChunk('event: text\ndata: 壞掉的\n\nevent: done\ndata: {}\n\n')
    expect(events).toEqual([{ event: 'done', data: {} }])
  })

  it('空字串回空結果', () => {
    expect(parseSseChunk('')).toEqual({ events: [], rest: '' })
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test lib/client/sseClient.test.ts`
Expected: FAIL — `Failed to resolve import "./sseClient"`

- [ ] **Step 3: 實作 SSE 解析與 placeholder**

`lib/client/sseClient.ts`:
```ts
export interface SseEvent {
  event: string
  data: unknown
}

/**
 * 從串流緩衝區切出完整事件。未收完的尾段回傳為 rest，由呼叫端接續下一批。
 * 單一事件的 data 若不是合法 JSON，只跳過該事件，不影響其餘事件。
 */
export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = []
  const blocks = buffer.split('\n\n')
  const rest = blocks.pop() ?? ''

  for (const block of blocks) {
    let name = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) name = line.slice(7).trim()
      else if (line.startsWith('data: ')) dataLines.push(line.slice(6))
    }
    if (dataLines.length === 0) continue
    try {
      events.push({ event: name, data: JSON.parse(dataLines.join('\n')) })
    } catch {
      // 壞掉的單一事件直接跳過
    }
  }
  return { events, rest }
}
```

`lib/client/placeholders.ts`:
```ts
export const PLACEHOLDERS = [
  '我在信義區上班，預算 1500 萬以內，想要安靜、生活機能好、通勤 40 分鐘內',
  '想找不要太潮濕、冬天不會太冷的地方，兩房，附近要有公園跟超市',
  '租屋，月租 2 萬內，捷運走路 10 分鐘，可以吵一點沒關係',
] as const

export const PLACEHOLDER_ROTATE_MS = 4500
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm test lib/client/sseClient.test.ts`
Expected: PASS（6 個測試）

- [ ] **Step 5: 實作 useChat**

`hooks/useChat.ts`:
```ts
'use client'

import { useCallback, useRef, useState } from 'react'
import { parseSseChunk } from '@/lib/client/sseClient'
import type { RankResult } from '@/lib/types/listing'
import type { ChatMessage } from '@/lib/types/chat'
import { WEIGHT_KEYS, type SearchProfile, type WeightKey } from '@/lib/types/profile'
import type { useSearchState } from './useSearchState'

export type WeightHighlights = Partial<Record<WeightKey, { from: number; to: number }>>

const HIGHLIGHT_DURATION_MS = 6000

function diffWeights(before: SearchProfile, after: SearchProfile): WeightHighlights {
  const out: WeightHighlights = {}
  for (const k of WEIGHT_KEYS) {
    if (before.weights[k] !== after.weights[k]) {
      out[k] = { from: before.weights[k], to: after.weights[k] }
    }
  }
  return out
}

export function useChat(search: ReturnType<typeof useSearchState>) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [highlighted, setHighlighted] = useState<WeightHighlights>({})
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || streaming) return

    const history: ChatMessage[] = [...messages, { role: 'user', content: trimmed }]
    setMessages([...history, { role: 'assistant', content: '' }])
    setStreaming(true)

    const before = search.profile

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: before, messages: history }),
      })
      if (!res.body) throw new Error('沒有回應串流')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let assistantText = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = parseSseChunk(buffer)
        buffer = rest

        for (const e of events) {
          if (e.event === 'profile') {
            const next = e.data as SearchProfile
            search.setProfile(next)
            const diff = diffWeights(before, next)
            if (Object.keys(diff).length > 0) {
              setHighlighted(diff)
              if (highlightTimer.current) clearTimeout(highlightTimer.current)
              highlightTimer.current = setTimeout(() => setHighlighted({}), HIGHLIGHT_DURATION_MS)
            }
          } else if (e.event === 'results') {
            const r = e.data as RankResult
            search.setResults(r.results)
            search.setRelaxations(r.relaxations)
          } else if (e.event === 'text') {
            assistantText += (e.data as { delta: string }).delta
            setMessages([...history, { role: 'assistant', content: assistantText }])
          } else if (e.event === 'error') {
            assistantText = (e.data as { message: string }).message
            setMessages([...history, { role: 'assistant', content: assistantText }])
          }
        }
      }

      if (!assistantText) {
        setMessages([...history, { role: 'assistant', content: '連線中斷了，請再說一次。' }])
      }
    } catch {
      setMessages([...history, { role: 'assistant', content: '連線失敗，請稍後再試。你仍然可以直接調整左邊的權重。' }])
    } finally {
      setStreaming(false)
    }
  }, [messages, search, streaming])

  return { messages, streaming, send, highlighted }
}
```

- [ ] **Step 6: 實作輸入框、對話串與初始畫面**

`components/Chat/Composer.tsx`:
```tsx
'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { PLACEHOLDERS, PLACEHOLDER_ROTATE_MS } from '@/lib/client/placeholders'

interface Props {
  onSubmit: (text: string) => void
  disabled: boolean
  large?: boolean
}

export function Composer({ onSubmit, disabled, large = false }: Props) {
  const [value, setValue] = useState('')
  const [placeholderIndex, setPlaceholderIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(
      () => setPlaceholderIndex((i) => (i + 1) % PLACEHOLDERS.length),
      PLACEHOLDER_ROTATE_MS,
    )
    return () => clearInterval(timer)
  }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (disabled || !value.trim()) return
    onSubmit(value)
    setValue('')
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={PLACEHOLDERS[placeholderIndex]}
        aria-label="描述你想要的居住條件"
        data-testid="composer-input"
        className={`min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none ${
          large ? 'px-4 py-3 text-base' : 'px-3 py-2 text-sm'
        }`}
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        data-testid="composer-submit"
        className={`shrink-0 rounded-lg bg-blue-600 font-medium text-white disabled:bg-neutral-300 ${
          large ? 'px-5 py-3' : 'px-3 py-2 text-sm'
        }`}
      >
        {disabled ? '思考中' : '送出'}
      </button>
    </form>
  )
}
```

`components/Chat/Landing.tsx`:
```tsx
'use client'

import { ModeToggle } from '@/components/ModeToggle/ModeToggle'
import { PLACEHOLDERS } from '@/lib/client/placeholders'
import type { Mode } from '@/lib/types/profile'
import { Composer } from './Composer'

interface Props {
  mode: Mode
  onModeChange: (m: Mode) => void
  onSubmit: (text: string) => void
  disabled: boolean
}

export function Landing({ mode, onModeChange, onSubmit, disabled }: Props) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-2xl">
        <h1 className="text-center text-3xl font-bold">安家</h1>
        <p className="mt-2 text-center text-sm text-neutral-500">
          用一句話描述你想要的生活，我幫你在台灣找到適合落腳的地方
        </p>

        <div className="mt-6 flex justify-center">
          <ModeToggle mode={mode} onChange={onModeChange} />
        </div>

        <div className="mt-4">
          <Composer onSubmit={onSubmit} disabled={disabled} large />
        </div>

        <ul className="mt-4 flex flex-wrap justify-center gap-2">
          {PLACEHOLDERS.map((p) => (
            <li key={p}>
              <button
                type="button"
                onClick={() => onSubmit(p)}
                disabled={disabled}
                className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-600 hover:border-blue-400 hover:text-blue-700 disabled:opacity-50"
              >
                {p.length > 24 ? `${p.slice(0, 24)}…` : p}
              </button>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-center text-xs text-neutral-400">
          目前使用示範資料，涵蓋臺北市與新北市。氣候為區域參考值，通勤時間為估計值。
        </p>
      </div>
    </main>
  )
}
```

`components/Chat/ChatPanel.tsx`:
```tsx
'use client'

import { useEffect, useRef } from 'react'
import type { ChatMessage } from '@/lib/types/chat'
import { Composer } from './Composer'

interface Props {
  messages: ChatMessage[]
  streaming: boolean
  onSubmit: (text: string) => void
}

export function ChatPanel({ messages, streaming, onSubmit }: Props) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" data-testid="chat-messages">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[92%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
              m.role === 'user'
                ? 'ml-auto bg-blue-600 text-white'
                : 'bg-neutral-100 text-neutral-800'
            }`}
          >
            {m.content || (streaming ? '思考中…' : '')}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="border-t border-neutral-200 p-3">
        <Composer onSubmit={onSubmit} disabled={streaming} />
      </div>
    </div>
  )
}
```

- [ ] **Step 7: 組合主畫面**

`app/page.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { ChatPanel } from '@/components/Chat/ChatPanel'
import { Landing } from '@/components/Chat/Landing'
import { ResultStrip } from '@/components/ListingCard/ResultStrip'
import { MapView } from '@/components/MapView/MapView'
import { ModeToggle } from '@/components/ModeToggle/ModeToggle'
import { WeightPanel } from '@/components/WeightPanel/WeightPanel'
import { useChat } from '@/hooks/useChat'
import { useDebouncedEffect } from '@/hooks/useDebouncedEffect'
import { useSearchState } from '@/hooks/useSearchState'
import type { Mode } from '@/lib/types/profile'

const RANK_DEBOUNCE_MS = 200

export default function Home() {
  const search = useSearchState()
  const chat = useChat(search)
  const [started, setStarted] = useState(false)

  // 開始對話後，profile 的任何變動（含 slider 拖動）都在 debounce 後重新排序。
  // 此路徑不呼叫 Gemini — 這是「手動調權重」的第二條路徑。
  useDebouncedEffect(
    () => { if (started && !chat.streaming) void search.rank(search.profile) },
    [search.profile, started, chat.streaming],
    RANK_DEBOUNCE_MS,
  )

  const setMode = (mode: Mode) => {
    const { budgetMin: _min, budgetMax: _max, ...hard } = search.profile.hard
    search.setProfile({ ...search.profile, mode, hard })
  }

  const handleSubmit = (text: string) => {
    setStarted(true)
    void chat.send(text)
  }

  if (!started) {
    return (
      <Landing
        mode={search.profile.mode}
        onModeChange={setMode}
        onSubmit={handleSubmit}
        disabled={chat.streaming}
      />
    )
  }

  return (
    <main className="flex h-screen">
      <aside className="flex w-[400px] shrink-0 flex-col border-r border-neutral-200 bg-white">
        <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3">
          <h1 className="text-base font-bold">安家</h1>
          <ModeToggle mode={search.profile.mode} onChange={setMode} />
        </header>

        <ChatPanel messages={chat.messages} streaming={chat.streaming} onSubmit={handleSubmit} />

        <details open className="border-t border-neutral-200">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-neutral-600">
            權重面板
          </summary>
          <WeightPanel
            profile={search.profile}
            onChange={search.setProfile}
            highlighted={chat.highlighted}
          />
        </details>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2 text-xs">
          <span className="text-neutral-500">找到 {search.results.length} 筆</span>
          {search.loading && <span className="text-blue-600">排序中…</span>}
          {search.error && <span className="text-red-600">{search.error}</span>}
        </div>

        {search.relaxations.length > 0 && (
          <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            為了找到結果，{search.relaxations.join('、')}
          </p>
        )}

        <div className="min-h-0 flex-1">
          <MapView
            results={search.results}
            hoveredId={search.hoveredId}
            onHover={search.setHoveredId}
            onSelect={search.setHoveredId}
          />
        </div>

        <div className="h-64 shrink-0 border-t border-neutral-200 bg-neutral-100">
          <ResultStrip
            results={search.results}
            hoveredId={search.hoveredId}
            onHover={search.setHoveredId}
          />
        </div>
      </section>
    </main>
  )
}
```

- [ ] **Step 8: 手動驗證完整對話流程**

```bash
pnpm dev
```
在瀏覽器操作：
1. 初始畫面顯示置中輸入框，placeholder 每 4.5 秒輪播
2. 點一個範例 chip → 進入結果畫面，地圖有點位、卡片有內容、對話出現串流的說明文字
3. 權重面板中被 agent 調整過的維度顯示 `50 → 70` 的藍色標記，6 秒後消失
4. 追問「我更在乎生活機能」→ amenities 權重上升，結果重排
5. 手動拖動 slider → 約 200ms 後結果重排，對話串不新增訊息

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(ui): 對話介面、初始畫面與權重變動高亮"
```

---

### Task 10: 行動版版面與端對端測試

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`
- Modify: `app/page.tsx`（加入行動版 tab 切換）
- Modify: `package.json`（加入 `test:all` 指令）

**Interfaces:**
- Consumes: Task 9 的完整主畫面
- Produces: `pnpm e2e` 可執行的端對端 smoke 測試

- [ ] **Step 1: 加入行動版 tab 切換**

在 `app/page.tsx` 的結果畫面加入手機版分頁。於 `useState` 區塊新增：
```tsx
const [mobileTab, setMobileTab] = useState<'chat' | 'map'>('chat')
```

`<main>` 內容改為（桌面維持左右分欄，手機以 tab 切換）：
```tsx
<main className="flex h-screen flex-col md:flex-row">
  {/* 手機版分頁列，桌面隱藏 */}
  <nav className="flex shrink-0 border-b border-neutral-200 bg-white md:hidden" aria-label="檢視切換">
    {([['chat', '對話'], ['map', '結果']] as const).map(([key, label]) => (
      <button
        key={key}
        type="button"
        onClick={() => setMobileTab(key)}
        aria-pressed={mobileTab === key}
        className={`flex-1 py-2 text-sm font-medium ${
          mobileTab === key ? 'border-b-2 border-blue-600 text-blue-700' : 'text-neutral-500'
        }`}
      >
        {label}
      </button>
    ))}
  </nav>

  <aside className={`flex min-h-0 flex-col border-neutral-200 bg-white md:flex md:w-[400px] md:shrink-0 md:border-r ${
    mobileTab === 'chat' ? 'flex flex-1' : 'hidden'
  }`}>
    {/* ...Task 9 的 header / ChatPanel / details 權重面板，內容不變... */}
  </aside>

  <section className={`min-w-0 flex-col md:flex md:flex-1 ${
    mobileTab === 'map' ? 'flex flex-1' : 'hidden'
  }`}>
    {/* ...Task 9 的狀態列 / relaxations / MapView / ResultStrip，內容不變... */}
  </section>
</main>
```

- [ ] **Step 2: 建立 Playwright 設定**

`playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
```

安裝瀏覽器：
```bash
pnpm exec playwright install chromium
```

- [ ] **Step 3: 寫端對端 smoke 測試**

`e2e/smoke.spec.ts`:
```ts
import { expect, test } from '@playwright/test'

/**
 * 這些測試不依賴 Gemini 金鑰 —— /api/chat 在無金鑰時仍會回 profile、results 與降級文案，
 * 因此結果畫面必定出現內容。這是「永不空畫面」原則的迴歸測試。
 */

test('初始畫面顯示對話框與範例', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('composer-input')).toBeVisible()
  await expect(page.getByRole('button', { name: '買房' })).toBeVisible()
})

test('送出訊息後出現地圖與物件卡片', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('composer-input').fill('預算 2000 萬以內，想要生活機能好的地方')
  await page.getByTestId('composer-submit').click()

  await expect(page.getByTestId('map')).toBeVisible()
  await expect(page.getByTestId('listing-card').first()).toBeVisible()
  await expect(page.getByTestId('chat-messages')).toContainText(/./)
})

test('拖動權重會改變結果順序', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()
  await expect(page.getByTestId('listing-card').first()).toBeVisible()

  const firstBefore = await page.getByTestId('listing-card').first().innerText()

  // 把「房屋價位」拉到最高：聚焦該 slider 後用 End 鍵
  const priceSlider = page.getByRole('slider', { name: '房屋價位' })
  await priceSlider.focus()
  await priceSlider.press('End')

  // 其餘維度拉到最低，放大排序差異
  for (const label of ['同區性價比', '天氣環境', '地理位置', '生活機能', '坪數格局', '屋況條件']) {
    const s = page.getByRole('slider', { name: label })
    await s.focus()
    await s.press('Home')
  }

  await expect(async () => {
    const firstAfter = await page.getByTestId('listing-card').first().innerText()
    expect(firstAfter).not.toBe(firstBefore)
  }).toPass()
})

test('權重面板的重設會把七個維度回到 50', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()
  await expect(page.getByTestId('weight-panel')).toBeVisible()

  const priceSlider = page.getByRole('slider', { name: '房屋價位' })
  await priceSlider.focus()
  await priceSlider.press('End')
  await expect(priceSlider).toHaveAttribute('aria-valuenow', '100')

  await page.getByRole('button', { name: '重設' }).click()
  await expect(priceSlider).toHaveAttribute('aria-valuenow', '50')
})

test('卡片 hover 會標示為選中狀態', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()

  const first = page.getByTestId('listing-card').first()
  await expect(first).toBeVisible()
  await expect(first).not.toHaveClass(/border-blue-500/)

  await first.hover()
  await expect(first).toHaveClass(/border-blue-500/)
})

test('手機版以分頁切換對話與結果', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()

  await expect(page.getByTestId('chat-messages')).toBeVisible()
  await page.getByRole('button', { name: '結果' }).click()
  await expect(page.getByTestId('map')).toBeVisible()
})
```

- [ ] **Step 4: 執行端對端測試**

```bash
pnpm exec playwright install chromium
pnpm e2e
```
Expected: 5 個測試全部 PASS

若「拖動權重會改變結果順序」不穩定，先確認 `/api/rank` 的 debounce 是否生效；不得以放寬斷言的方式掩蓋問題。

**hover 測試的已知限制**：`卡片 hover 會標示為選中狀態` 只驗證了「卡片 → 狀態 → 卡片」這條迴路。
地圖那一側（marker 隨 `hoveredId` 放大）畫在 canvas 上，Playwright 無法直接斷言，
只能靠讀程式碼確認 `toGeoJson` 寫入的 feature id 與 `setFeatureState` 讀的是同一個。
這個限制是誠實記錄，不是待辦 —— 除非引入視覺回歸測試，否則無法自動化。

- [ ] **Step 5: 加入整合測試指令**

`package.json` 的 `scripts` 加入：
```json
"test:all": "vitest run && playwright test"
```

- [ ] **Step 6: 全套驗證**

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm e2e
```
Expected: 單元測試全綠、型別檢查無錯誤、build 成功、e2e 全綠

- [ ] **Step 7: 撰寫 README**

`README.md`:
```markdown
# 安家 — 台灣選址房仲 Agent

用自然語言描述想要的生活條件，透過多輪對話調整權重，在地圖上找到適合的房屋物件。

## 快速開始

```bash
pnpm install
cp .env.example .env.local   # 填入 GEMINI_API_KEY
pnpm db:push                 # 建立 SQLite schema
pnpm db:seed                 # 灌入示範資料
pnpm dev
```

開啟 http://localhost:3000

## 指令

| 指令 | 說明 |
| --- | --- |
| `pnpm dev` | 開發伺服器 |
| `pnpm test` | 單元測試 |
| `pnpm e2e` | 端對端測試 |
| `pnpm test:all` | 全部測試 |
| `pnpm db:push` | 建立／更新資料庫 schema |
| `pnpm db:seed` | 重新產生示範資料 |

## 架構

Gemini 只負責兩件事：把自然語言轉成 `SearchProfile` 的變動量，以及把排序結果寫成人話。
排序由 `lib/scoring` 的純函式完成 —— 可單元測試、毫秒回應，權重面板拖動時完全不呼叫 LLM。

設計文件：`docs/superpowers/specs/2026-08-17-taiwan-housing-agent-design.md`

## 目前的資料

示範資料涵蓋臺北市與新北市共 20 個行政區、360 筆物件，由 `scripts/seed.ts` 確定性產生。
氣候值為中央氣象署測站氣候平均的近似值，POI 與距離為模擬值。
真實資料抓取與 enrich pipeline 見計畫 B。
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: 行動版版面、端對端測試與 README"
```

---

## 完成後的狀態

- 完整對話流程可跑通：輸入中文需求 → agent 萃取條件 → 地圖與卡片顯示結果 → 串流解釋 → 追問可調整權重
- 權重面板可手動拖動，即時重排且不呼叫 LLM
- 買賣／租賃可切換
- 無 Gemini 金鑰時仍可運作（降級文案 + 排序照常）
- 單元測試涵蓋評分引擎的單調性、正規化邊界、放寬策略、多樣性上限、profile 合併與驗證、SSE 解析
- e2e 涵蓋初始畫面、結果顯示、權重拖動重排、重設、行動版分頁
- 萃取品質的整合測試已備妥，需要時以 `RUN_LLM_TESTS=1` 開啟

## 尚未完成（計畫 B 的範圍）

- 591 / 樂屋網抓取器（`ListingSource` 介面已在 spec 定義，尚未實作）
- 實價登錄備援物件池
- CWA 氣象、環境部 AQI、OSM Overpass POI、TDX 車站的真實 enrich
- 地址 geocode 與快取
- 擴充到六都
- 行政區邊界 GeoJSON 與 choropleth 圖層

