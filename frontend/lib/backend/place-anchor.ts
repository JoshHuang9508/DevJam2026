import 'server-only'
import { and, count, eq, like } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import * as schema from '@/lib/db/schema'
import { REGION_CITIES, normalizeCity, type Region } from '@/lib/types/profile'

/**
 * 把「土城」「高雄」「南部」這種模糊講法解析成座標 + 半徑。
 *
 * 座標一律查 districts 表（264 個由實際物件反推的真實重心），**不讓模型自己給經緯度**。
 * 模型很敢生一組看起來合理但差幾十公里的座標，而那種錯誤在地圖上不會報錯，
 * 只會安靜地回傳錯誤區域的房子。
 *
 * 回 null 代表查無此地，呼叫端應該照實說找不到，而不是硬猜一個。
 */
export interface PlaceAnchor {
  lat: number
  lng: number
  radiusKm: number
  label: string
}

/** 不同層級的預設半徑：講「土城」是想找那一區附近，講「高雄」是整個都會區。 */
const DEFAULT_RADIUS = { district: 5, city: 20, region: 80 } as const

/**
 * 「靠近」「附近」這類修飾詞。prompt 已經要求 agent 只傳地名，但模型不一定照做，
 * 而且使用者原話本來就長這樣。剝掉比要求模型完美更可靠。
 */
const PREFIXES = /^(靠近|鄰近|接近|近|在|位於|想找|要找)/
const SUFFIXES = /(附近|周邊|周圍|一帶|旁邊|那邊|這邊|附近的|左右|方圓)$/

export function resolvePlace(query: string, radiusKm?: number): PlaceAnchor | null {
  let raw = query.normalize('NFKC').trim()
  // 兩邊各剝一次就夠：「靠近土城附近」這種疊字很少見，剝到空字串反而危險
  raw = raw.replace(PREFIXES, '').replace(SUFFIXES, '').trim()
  if (!raw) return null

  // 1) 區域（北部／南部…）。這個不查表，直接用該區域所有縣市重心的平均。
  const region = matchRegion(raw)
  if (region) {
    const anchor = averageOf(REGION_CITIES[region].map(normalizeCity))
    if (anchor) return { ...anchor, radiusKm: radiusKm ?? DEFAULT_RADIUS.region, label: region }
  }

  const db = getDb()

  // 2) 行政區。使用者常省略「區/鄉/鎮/市」，所以先試原字串再試加後綴的前綴比對。
  //    同名行政區（大安區有臺北與臺中兩個）取物件數最多的那一個 —— 講「大安」
  //    而沒有其他線索時，指臺北的機率遠高於臺中。
  const districtRows = db
    .select({ city: schema.districts.city, name: schema.districts.name, lat: schema.districts.centroidLat, lng: schema.districts.centroidLng })
    .from(schema.districts)
    .where(like(schema.districts.name, `${raw}%`))
    .all()
  if (districtRows.length > 0) {
    const best = pickByListingCount(districtRows)
    return {
      lat: best.lat,
      lng: best.lng,
      radiusKm: radiusKm ?? DEFAULT_RADIUS.district,
      label: `${best.city}${best.name}`,
    }
  }

  // 3) 縣市。同樣容忍省略「市/縣」。
  const cityName = matchCity(raw)
  if (cityName) {
    const anchor = averageOf([cityName])
    if (anchor) return { ...anchor, radiusKm: radiusKm ?? DEFAULT_RADIUS.city, label: cityName }
  }

  return null
}

function matchRegion(raw: string): Region | null {
  const regions = Object.keys(REGION_CITIES) as Region[]
  return regions.find((r) => raw === r || raw === r.replace('部', '') + '部') ?? null
}

function matchCity(raw: string): string | null {
  const db = getDb()
  const rows = db.selectDistinct({ city: schema.districts.city }).from(schema.districts).all()
  const normalized = normalizeCity(raw)
  return rows.map((r) => r.city).find((c) => {
    const n = normalizeCity(c)
    // 「高雄」→「高雄市」、「臺北」→「臺北市」
    return n === normalized || n.startsWith(normalized)
  }) ?? null
}

/** 一組縣市的行政區重心平均。用平均而不是隨便挑一個，才不會把「南部」錨在最北邊。 */
function averageOf(cities: string[]): { lat: number; lng: number } | null {
  const db = getDb()
  const wanted = new Set(cities.map(normalizeCity))
  const rows = db
    .select({ city: schema.districts.city, lat: schema.districts.centroidLat, lng: schema.districts.centroidLng })
    .from(schema.districts)
    .all()
    .filter((r) => wanted.has(normalizeCity(r.city)))
  if (rows.length === 0) return null
  return {
    lat: rows.reduce((a, r) => a + r.lat, 0) / rows.length,
    lng: rows.reduce((a, r) => a + r.lng, 0) / rows.length,
  }
}

/**
 * 同名行政區取物件數最多的那一個。必須用 city + district 一起比 ——
 * 只比 district 名的話「大安區」會把臺北與臺中的數量加在一起，選誰都一樣。
 */
function pickByListingCount<T extends { city: string; name: string }>(rows: T[]): T {
  if (rows.length === 1) return rows[0]
  const db = getDb()
  let best = rows[0]
  let bestCount = -1
  for (const row of rows) {
    const [{ n }] = db
      .select({ n: count() })
      .from(schema.listings)
      .where(and(eq(schema.listings.city, row.city), eq(schema.listings.district, row.name)))
      .all()
    if (n > bestCount) { bestCount = n; best = row }
  }
  return best
}
