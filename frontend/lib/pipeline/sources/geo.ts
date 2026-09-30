import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fetchCached, haversineMeters, log, pointInRing, twd97ToWgs84 } from '../util'

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
        'user-agent': 'zhuchao-housing-agent/0.1 (data pipeline; contact via github.com/JoshHuang9508/DevJam2026)',
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
