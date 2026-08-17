import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fetchCached, haversineMeters, log, pointInRing, stripFloorSuffix, twd97ToWgs84 } from '../util'

export interface Point { lat: number; lng: number }

/* ------------------------------------------------------------------ */
/* 捷運出入口                                                          */
/* ------------------------------------------------------------------ */

/**
 * 臺北捷運車站出入口座標（data.taipei，免金鑰）。
 *
 * 用出入口而不是車站中心點是刻意的：一個車站的中心可能離你實際會走的那個出口 300 公尺，
 * 拿中心點算步行距離會系統性低估通勤成本。
 */
const MRT_EXITS_URL = 'https://data.taipei/api/v1/dataset/307a7f61-e302-4108-a817-877ccbfca7c1?scope=resourceAquire&limit=1000'

export async function fetchMrtExits(cacheDir: string): Promise<Point[]> {
  const buffer = await fetchCached(MRT_EXITS_URL, `${cacheDir}/mrt-exits.json`, { maxAgeMs: 30 * 86400_000 })
  const json = JSON.parse(new TextDecoder().decode(buffer)) as {
    result?: { results?: Record<string, string>[] }
  }
  const rows = json.result?.results ?? []
  const points = rows
    .map((row) => ({ lat: Number(row['緯度']), lng: Number(row['經度']) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat > 20 && p.lat < 27)
  log('mrt', `${points.length} 個捷運出入口`)
  return points
}

/* ------------------------------------------------------------------ */
/* OpenStreetMap POI                                                   */
/* ------------------------------------------------------------------ */

export type PoiKind = 'convenience' | 'supermarket' | 'school' | 'hospital' | 'park' | 'restaurant'

export type PoiIndex = Record<PoiKind, Point[]>

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'

/**
 * 一次把臺北市 + 新北市的六類 POI 抓回來。
 *
 * 政府的超商／超市資料只有地址沒有座標（財政部稅籍檔），學校與醫療機構也一樣，
 * 全部都得再送去 geocode。OSM 一次呼叫就給座標。
 *
 * **範圍必須涵蓋所有有物件的縣市。** 原本只查雙北，結果非雙北的物件每一項 POI
 * 都拿到 0 —— 那不是「附近沒有超商」，是「我根本沒查那裡」，但分數算不出這個差別，
 * 於是高雄台中的房子在生活機能維度上全部墊底。這種錯不會報錯，只會安靜地排錯。
 *
 * 授權要注意：OSM 是 ODbL，share-alike 比政府那套 CC-BY 嚴格，且必須標示
 * 「© OpenStreetMap contributors」。
 */
const OVERPASS_QUERY = `
[out:json][timeout:600];
area["boundary"="administrative"]["admin_level"="4"]["name:zh"~"臺北市|新北市|基隆市|桃園市|新竹市|新竹縣|苗栗縣|臺中市|彰化縣|南投縣|雲林縣|嘉義市|嘉義縣|臺南市|高雄市|屏東縣|宜蘭縣|花蓮縣|臺東縣|澎湖縣|金門縣|連江縣"]->.a;
(
  nwr["shop"="convenience"](area.a);
  nwr["shop"="supermarket"](area.a);
  nwr["amenity"="school"](area.a);
  nwr["amenity"~"^(hospital|clinic|doctors)$"](area.a);
  nwr["leisure"="park"](area.a);
  nwr["amenity"="restaurant"](area.a);
);
out center;
`.trim()

interface OverpassElement {
  type: string
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

export async function fetchPoi(cacheDir: string): Promise<PoiIndex> {
  const cachePath = `${cacheDir}/osm-poi.json`
  let raw: string

  // Overpass 對每個 IP 只有 2 個並行 slot、每天 1 萬次查詢的 fair use，
  // 而 POI 一週內幾乎不會變 —— 快取 7 天，別把人家的免費服務當自己的資料庫。
  if (existsSync(cachePath) && Date.now() - statSync(cachePath).mtimeMs < 7 * 86400_000) {
    raw = readFileSync(cachePath, 'utf-8')
  } else {
    const response = await fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        // Overpass 明文要求要帶 User-Agent 或 Referer，沒帶會被擋
        'user-agent': 'anjia-housing-agent/0.1 (data pipeline; contact via github.com/JoshHuang9508/DevJam2026)',
      },
      body: `data=${encodeURIComponent(OVERPASS_QUERY)}`,
      signal: AbortSignal.timeout(900_000),
    })
    if (!response.ok) throw new Error(`Overpass ${response.status} ${response.statusText}`)
    raw = await response.text()
    mkdirSync(dirname(cachePath), { recursive: true })
    writeFileSync(cachePath, raw)
  }

  const elements = (JSON.parse(raw) as { elements?: OverpassElement[] }).elements ?? []
  const index: PoiIndex = {
    convenience: [], supermarket: [], school: [], hospital: [], park: [], restaurant: [],
  }

  for (const element of elements) {
    const lat = element.lat ?? element.center?.lat
    const lon = element.lon ?? element.center?.lon
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const kind = classify(element.tags ?? {})
    if (kind) index[kind].push({ lat: lat as number, lng: lon as number })
  }

  log('poi', Object.entries(index).map(([k, v]) => `${k}=${v.length}`).join(' '))
  return index
}

function classify(tags: Record<string, string>): PoiKind | null {
  if (tags.shop === 'convenience') return 'convenience'
  if (tags.shop === 'supermarket') return 'supermarket'
  if (tags.amenity === 'school') return 'school'
  if (tags.amenity === 'hospital' || tags.amenity === 'clinic' || tags.amenity === 'doctors') return 'hospital'
  if (tags.leisure === 'park') return 'park'
  if (tags.amenity === 'restaurant') return 'restaurant'
  return null
}

/* ------------------------------------------------------------------ */
/* 空間索引                                                            */
/* ------------------------------------------------------------------ */

/**
 * 粗網格索引。三千多筆物件 × 兩萬個 POI 硬跑是六千萬次距離計算，
 * 在正式機那顆 2 vCPU 上要好幾分鐘；切成 ~1km 的網格後只掃鄰近九格。
 */
export class GridIndex {
  private readonly cells = new Map<string, Point[]>()
  /** 緯度 0.01 度 ≈ 1.11 km，台灣的經度 0.01 度 ≈ 1.01 km，當成 1km 網格夠用。 */
  private readonly size = 0.01

  constructor(points: Point[]) {
    for (const point of points) {
      const key = this.key(point.lat, point.lng)
      const bucket = this.cells.get(key)
      if (bucket) bucket.push(point)
      else this.cells.set(key, [point])
    }
  }

  private key(lat: number, lng: number): string {
    return `${Math.floor(lat / this.size)}:${Math.floor(lng / this.size)}`
  }

  /** 半徑內的點數。radius 必須小於等於網格大小，否則要掃更多格。 */
  countWithin(origin: Point, radiusMeters: number): number {
    let count = 0
    for (const point of this.neighbours(origin, radiusMeters)) {
      if (haversineMeters(origin, point) <= radiusMeters) count += 1
    }
    return count
  }

  /** 最近點的距離（公尺）。找不到回 null。 */
  nearestMeters(origin: Point, maxRadiusMeters = 5000): number | null {
    let best: number | null = null
    for (const point of this.neighbours(origin, maxRadiusMeters)) {
      const distance = haversineMeters(origin, point)
      if (best === null || distance < best) best = distance
    }
    return best
  }

  private *neighbours(origin: Point, radiusMeters: number): Generator<Point> {
    const span = Math.max(1, Math.ceil(radiusMeters / 1000))
    const baseLat = Math.floor(origin.lat / this.size)
    const baseLng = Math.floor(origin.lng / this.size)
    for (let dy = -span; dy <= span; dy += 1) {
      for (let dx = -span; dx <= span; dx += 1) {
        const bucket = this.cells.get(`${baseLat + dy}:${baseLng + dx}`)
        if (bucket) yield* bucket
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 災害潛勢                                                            */
/* ------------------------------------------------------------------ */

const LIQUEFACTION_URL = 'https://soil.taipei/Taipei2019/Main/pages/TPLiquid_84.GeoJSON'
const FLOOD_POINTS_URL = 'https://datahub.ncdr.nat.gov.tw/api/dataset/19409a2a-4326-40d6-957f-eb284137440b/resource/d5a9e6da-a72c-4ad6-be55-226e39e459a2/download'

export interface LiquefactionZone { level: number; rings: number[][][] }

/**
 * 臺北市土壤液化潛勢圖。CRS84（= WGS84 經緯度），可以直接做點在多邊形內判斷。
 * 只有臺北市 —— 新北市的中級圖資沒有公開的 GeoJSON/SHP 下載，查不到就是 null。
 */
export async function fetchLiquefaction(cacheDir: string): Promise<LiquefactionZone[]> {
  const buffer = await fetchCached(LIQUEFACTION_URL, `${cacheDir}/liquefaction.geojson`, { maxAgeMs: 30 * 86400_000 })
  const json = JSON.parse(new TextDecoder().decode(buffer)) as {
    features?: { properties?: Record<string, unknown>; geometry?: { type: string; coordinates: unknown } }[]
  }
  const zones: LiquefactionZone[] = []
  for (const feature of json.features ?? []) {
    const level = Number(feature.properties?.class)
    if (!Number.isFinite(level)) continue
    const geometry = feature.geometry
    if (!geometry) continue
    // Polygon 的 coordinates 是 ring[]，MultiPolygon 多一層，統一攤平成 ring[]
    const polygons = geometry.type === 'MultiPolygon'
      ? (geometry.coordinates as number[][][][])
      : [geometry.coordinates as number[][][]]
    for (const polygon of polygons) zones.push({ level, rings: polygon })
  }
  log('hazard', `${zones.length} 個土壤液化潛勢區塊（僅臺北市）`)
  return zones
}

/** 1 低 / 2 中 / 3 高；不在任何區塊內（含整個新北市）回 null 表示未檢測。 */
export function liquefactionLevel(point: Point, zones: LiquefactionZone[]): number | null {
  for (const zone of zones) {
    // rings[0] 是外環，其餘是洞。落在洞裡不算在這個區塊內。
    if (!zone.rings.length || !pointInRing(point, zone.rings[0])) continue
    const inHole = zone.rings.slice(1).some((ring) => pointInRing(point, ring))
    if (!inHole) return zone.level
  }
  return null
}

/**
 * NCDR 近五年淹水災點。座標是 TWD97 TM2 公尺（EPSG:3826），不轉的話會落到非洲外海。
 *
 * 刻意用實際淹水紀錄而不是水利署的淹水潛勢圖：潛勢圖的使用條款明文寫「不得援引作為
 * 土地使用管制或土地開發限制的判定依據」，拿來扣某一戶的分數是踩線的；
 * 歷史災點沒有這個限制，而且對「這附近淹過水嗎」這個問題更直接。
 */
export async function fetchFloodPoints(cacheDir: string): Promise<Point[]> {
  const buffer = await fetchCached(FLOOD_POINTS_URL, `${cacheDir}/flood-points.csv`, { maxAgeMs: 30 * 86400_000 })
  const text = new TextDecoder('utf-8').decode(buffer)
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []

  const header = lines[0].split(',').map((h) => h.trim().replace(/^﻿/, ''))
  const xIndex = header.findIndex((h) => /^X_?97$/i.test(h))
  const yIndex = header.findIndex((h) => /^Y_?97$/i.test(h))
  if (xIndex < 0 || yIndex < 0) {
    log('hazard', `淹水災點欄位對不上（${header.join('/')}），略過`)
    return []
  }

  const points: Point[] = []
  for (const line of lines.slice(1)) {
    const cells = line.split(',')
    const x = Number(cells[xIndex])
    const y = Number(cells[yIndex])
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const point = twd97ToWgs84(x, y)
    // 全台都要留。之前只留北北基，結果是高雄台南這些真的會淹的地方全部拿到 0 個災點，
    // 在災害維度上變成「最安全」—— 那不是資料，是我自己的篩選造成的假象。
    // 範圍檢查只當成座標轉換有沒有轉爛的健全性檢查。
    if (point.lat > 21.5 && point.lat < 26.5 && point.lng > 118 && point.lng < 122.5) points.push(point)
  }
  log('hazard', `${points.length} 個全台淹水災點`)
  return points
}

/* ------------------------------------------------------------------ */
/* Geocoding                                                           */
/* ------------------------------------------------------------------ */

interface GeocodeCache { [address: string]: { lat: number; lng: number } | null }

/** 每查幾筆就把快取落地一次。 */
const SAVE_EVERY = 200

/**
 * 台灣（含離島）的座標範圍。金門 118.2°E、馬祖東引 26.38°N、鵝鑾鼻 21.9°N、
 * 彭佳嶼 122.08°E，各留一點邊。
 *
 * 需要這個檢查是因為實價登錄有些「門牌」其實是地號（例如「塘岐段684地號」），
 * Google 找不到對應街址時會挑一個字面相近的地方 —— 實測有一筆連江縣的地號
 * 被配到江蘇（31.84°N）。落在範圍外一律當成查無，退回行政區重心。
 */
const TAIWAN_BOUNDS = { minLat: 21.5, maxLat: 26.5, minLng: 118.1, maxLng: 122.2 }

function inTaiwan(point: Point): boolean {
  return point.lat >= TAIWAN_BOUNDS.minLat && point.lat <= TAIWAN_BOUNDS.maxLat
    && point.lng >= TAIWAN_BOUNDS.minLng && point.lng <= TAIWAN_BOUNDS.maxLng
}

/**
 * 實價登錄完全沒有座標，只有門牌 —— 這是整條 pipeline 唯一需要付費 API 的地方。
 *
 * 注意這把金鑰不能用 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY —— 那把設了 HTTP referrer 限制，
 * 從伺服器呼叫會被 REQUEST_DENIED。要另外開一把用 IP 限制的。
 *
 * 查不到就回 null，退路交給呼叫端（見 pipeline 的兩段式定位）。
 */
export class Geocoder {
  private readonly cache: GeocodeCache
  private hits = 0
  private misses = 0
  private failures = 0
  private budgetSpent = 0
  private unsaved = 0

  constructor(
    private readonly cachePath: string,
    private readonly apiKey?: string,
    /** 一次執行最多新查幾筆。Google Geocoding 約 US$5/1000，這是防呆用的花費上限。 */
    private readonly budget = Number.POSITIVE_INFINITY,
  ) {
    this.cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf-8')) as GeocodeCache : {}
  }

  get stats() {
    return { cached: this.hits, geocoded: this.misses, failed: this.failures, budgetSpent: this.budgetSpent }
  }

  get budgetExhausted(): boolean {
    return this.budgetSpent >= this.budget
  }

  /**
   * 查一個門牌。回 null 代表這一筆沒有精確座標 —— 呼叫端要自己決定退路，
   * 不要在這裡就退回行政區重心：全台 368 個區不可能硬寫成表，
   * 正確的退路是「同一區其他已定位物件的重心」，而那要等第一輪跑完才算得出來。
   */
  async lookup(address: string): Promise<Point | null> {
    const key = stripFloorSuffix(address)

    if (key in this.cache) {
      this.hits += 1
      return this.cache[key]
    }
    if (!this.apiKey || this.budgetExhausted) return null

    this.budgetSpent += 1
    const point = await this.callGoogle(key)
    this.cache[key] = point
    if (point) this.misses += 1
    else this.failures += 1

    // 每 200 筆就落地一次。geocoding 是**付費**的，把上萬筆結果全放在記憶體裡
    // 等跑完才寫，中途一掛掉就是錢花了、一筆都沒留下，重跑要再付一次。
    this.unsaved += 1
    if (this.unsaved >= SAVE_EVERY) this.save()
    return point
  }

  private async callGoogle(address: string): Promise<Point | null> {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
    url.searchParams.set('address', address)
    url.searchParams.set('region', 'tw')
    url.searchParams.set('language', 'zh-TW')
    url.searchParams.set('key', this.apiKey as string)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) return null
      const json = await response.json() as {
        status: string
        results?: { geometry?: { location?: { lat: number; lng: number } } }[]
      }
      // 這兩種是設定或額度問題，不是「這個地址查不到」。繼續打下去只會把幾千筆
      // 全部靜靜地退成近似值，所以直接讓整條 pipeline 停下來。
      if (json.status === 'OVER_QUERY_LIMIT' || json.status === 'REQUEST_DENIED') {
        throw new Error(`Google Geocoding ${json.status} —— 檢查金鑰是否啟用 Geocoding API 且沒有 referrer 限制`)
      }
      const location = json.results?.[0]?.geometry?.location
      if (!location || !Number.isFinite(location.lat)) return null
      const point = { lat: location.lat, lng: location.lng }
      return inTaiwan(point) ? point : null
    } catch (error) {
      if (error instanceof Error && error.message.includes('Google Geocoding')) throw error
      return null
    }
  }

  save(): void {
    mkdirSync(dirname(this.cachePath), { recursive: true })
    // 先寫暫存檔再 rename：直接覆寫的話，寫到一半被中斷會留下一個壞掉的 JSON，
    // 下一次啟動 JSON.parse 就會爆掉，等於整份快取報銷。
    const tmp = `${this.cachePath}.tmp`
    writeFileSync(tmp, JSON.stringify(this.cache))
    renameSync(tmp, this.cachePath)
    this.unsaved = 0
  }
}
