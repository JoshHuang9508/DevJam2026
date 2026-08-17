import 'server-only'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import * as schema from '@/lib/db/schema'
import { areaExcludes } from '@/lib/scoring/filter'
import type { HardConstraints, Mode } from '@/lib/types/profile'

interface Row {
  city: string
  district: string
  price: number
  area: number
}

function rows(mode: Mode): Row[] {
  try {
    return getDb()
      .select({
        city: schema.listings.city,
        district: schema.listings.district,
        price: schema.listings.price,
        area: schema.listings.area,
      })
      .from(schema.listings)
      .where(eq(schema.listings.mode, mode))
      .all()
  } catch {
    return []
  }
}

export interface DistrictCoverage {
  city: string
  district: string
  count: number
  /** 中位數。買賣是萬元總價、租賃是元月租，跟 listings.price 同單位。 */
  medianPrice: number
  medianArea: number
}

export interface DatasetSummary {
  mode: Mode
  total: number
  cities: string[]
  districts: DistrictCoverage[]
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const raw = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  return Math.round(raw * 10) / 10
}

/**
 * 資料集實際涵蓋了什麼。agent 必須先知道這件事才答得出「這裡有沒有資料」——
 * 沒有這個工具的話，被問到沒涵蓋的縣市它只會拿到 0 筆結果，然後把原因猜成
 * 「條件太嚴」，而真正的原因是那個地方根本不在資料集裡。這兩者對使用者的
 * 下一步完全不同：一個該放寬預算，一個該換地方或直接被告知查不到。
 */
export function datasetSummary(mode: Mode): DatasetSummary {
  const all = rows(mode)
  const byDistrict = new Map<string, Row[]>()
  for (const row of all) {
    const key = `${row.city}|${row.district}`
    const bucket = byDistrict.get(key)
    if (bucket) bucket.push(row)
    else byDistrict.set(key, [row])
  }

  const districts: DistrictCoverage[] = [...byDistrict.entries()]
    .map(([key, bucket]) => {
      const [city, district] = key.split('|')
      return {
        city,
        district,
        count: bucket.length,
        medianPrice: median(bucket.map((r) => r.price)),
        medianArea: median(bucket.map((r) => r.area)),
      }
    })
    .sort((a, b) => b.count - a.count)

  return {
    mode,
    total: all.length,
    cities: [...new Set(all.map((r) => r.city))],
    districts,
  }
}

/**
 * 指定的地區在資料集裡有幾筆。0 筆時要講的是「資料集沒有」，不是「條件太嚴」——
 * 這個註記取代了舊的做法（悄悄把 districts 條件刪掉改成全域搜尋），因為那會讓
 * 使用者拿到一堆他沒要的地區的物件，還以為那就是他要的地方的行情。
 */
export function areaCoverageNote(mode: Mode, hard: HardConstraints): string | null {
  const named = [...(hard.districts ?? []), ...(hard.cities ?? []), ...(hard.regions ?? [])]
  if (named.length === 0) return null
  const matched = rows(mode).filter((r) => !areaExcludes(r, hard))
  if (matched.length > 0) return null
  return `物件資料集目前沒有${named.join('、')}的資料（涵蓋範圍：${
    datasetSummary(mode).cities.join('、') || '無'
  }），所以這個地區查不到物件。地區條件不會自動放寬。`
}

/** True when data/app.db exists and can be opened. */
export function listingsDbAvailable(): boolean {
  try {
    getDb()
    return true
  } catch {
    return false
  }
}
