import type { FeatureKey, ListingWithFeatures } from '@/lib/types/listing'

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
    globalMedian.set(key, median(pool.map((l) => l.features[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))))
    for (const [dk, group] of byDistrict) {
      districtMedian.set(
        `${dk}|${key}`,
        median(group.map((l) => l.features[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))),
      )
    }
  }

  return pool.map((listing) => {
    const dataGaps: string[] = []
    const features = {} as { [K in FeatureKey]: number }
    for (const key of keys) {
      const raw = listing.features[key]
      // 非有限值一律當成缺值。型別上只會是 number | null，但實務上只要有一個
      // 欄位對應錯掉（schema 漂移、手寫的 SQL、之後新增的欄位忘了填），這裡拿到的
      // 就是 undefined，而 dimensions 裡的 Math.max(0, undefined) 會靜靜回 NaN，
      // 整筆分數變 NaN、排序全毀，卻不會有任何錯誤訊息。
      if (typeof raw === 'number' && Number.isFinite(raw)) {
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
