import type { ListingWithFeatures, ScoredListing } from '@/lib/types/listing'
import { DEFAULT_PROFILE, WEIGHT_KEYS, type SearchProfile, type WeightKey } from '@/lib/types/profile'
import { DIMENSIONS } from './dimensions'
import { applyHardFilter } from './filter'
import { fillDataGaps } from './gaps'
import { minMaxNormalize } from './normalize'

export const MAX_RESULTS = 100
/**
 * 同一行政區最多幾筆。這是**多樣性護欄**，不是硬上限 ——
 * 候選池本來就只剩少數幾區時（使用者指定「我只要大安區」是常見情況），
 * 死守 5 會讓結果只剩 5 筆，而不是把該區前 100 名排給他看。
 * 所以實際的 cap 取「這個值」與「平均分給每一區的名額」的較大者。
 */
export const MAX_PER_DISTRICT = 5
/**
 * 同一縣市最多幾筆。行政區那一層的配額擋不住這件事 —— 全台 368 個區、
 * 每區 5 筆的話，100 個名額仍然可能全被成交量最大的新北與桃園吃掉，
 * 其他 20 個縣市一筆都排不進來。同樣是取較大者，候選池只剩一兩個縣市時放寬。
 *
 * 寫成**比例**而不是絕對值：這個護欄的意思是「單一縣市最多佔四分之一」，
 * 絕對值會隨著 limit 改變而失去意義 —— limit 從 100 降到 50 時，
 * 固定的 25 就從「四分之一」變成「一半」，兩個縣市就能把結果吃光。
 */
export const CITY_SHARE = 0.25

const clampWeight = (v: number): number => (v < 0 ? 0 : v > 100 ? 100 : v)

/**
 * 把 0..100 的權重 clamp 後正規化為總和 1。
 *
 * 全為 0 時退回「預設權重的正規化結果」而不是無差別等權：等權會把 fengshui 也算進去，
 * 讓一個明確設為 0 的信仰性維度拿到 1/8 的比重，違反「風水必須 opt-in」與
 * 「未開啟風水時排序與加入本功能前逐筆相同」兩條不變量。
 * DEFAULT_PROFILE 的 fengshui 是 0，其餘七維同值，因此這條退路等於七維各 1/7、風水 0。
 */
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

  if (total === 0) {
    let fallbackTotal = 0
    for (const k of WEIGHT_KEYS) {
      const v = clampWeight(DEFAULT_PROFILE.weights[k] ?? 0)
      clamped[k] = v
      fallbackTotal += v
    }
    // 預設權重本身全為 0 的話除法會炸出 NaN，這時才真的無差別等權
    if (fallbackTotal === 0) {
      const out = {} as Record<WeightKey, number>
      for (const k of WEIGHT_KEYS) out[k] = 1 / WEIGHT_KEYS.length
      return out
    }
    total = fallbackTotal
  }

  const out = {} as Record<WeightKey, number>
  for (const k of WEIGHT_KEYS) {
    out[k] = clamped[k] / total
  }
  return out
}

export interface ScoreOptions {
  /** 覆寫 MAX_RESULTS。 */
  limit?: number
}

/**
 * 排序不看地圖視角。前 N 名是**整個候選池**的前 N 名，跟相機在哪裡無關 ——
 * 視角過濾曾經做在這裡，結果是拖一下地圖就換一批「前 30 名」，同一間房子的
 * 名次與顏色會跟著相機跳。現在地圖只是不畫視角外的圖釘（見 MapView），
 * 名次、清單與 agent 講的那份始終是同一份。
 */
export function score(
  profile: SearchProfile,
  pool: ListingWithFeatures[],
  options: ScoreOptions = {},
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

  const maxResults = options.limit ?? MAX_RESULTS

  // 多樣性護欄有兩層：縣市與行政區。兩層都是「取設定值與平均名額的較大者」，
  // 候選池被篩窄時自動放寬，否則使用者指定單一行政區只會拿到 5 筆。
  const districtCount = new Set(scored.map((r) => `${r.city}|${r.district}`)).size
  const cityCount = new Set(scored.map((r) => r.city)).size
  const perDistrictCap = Math.max(MAX_PER_DISTRICT, Math.ceil(maxResults / Math.max(districtCount, 1)))
  const perCityCap = Math.max(Math.ceil(maxResults * CITY_SHARE), Math.ceil(maxResults / Math.max(cityCount, 1)))

  const perDistrict = new Map<string, number>()
  const perCity = new Map<string, number>()
  const diverse: ScoredListing[] = []
  for (const r of scored) {
    const districtKey = `${r.city}|${r.district}`
    if ((perDistrict.get(districtKey) ?? 0) >= perDistrictCap) continue
    if ((perCity.get(r.city) ?? 0) >= perCityCap) continue
    perDistrict.set(districtKey, (perDistrict.get(districtKey) ?? 0) + 1)
    perCity.set(r.city, (perCity.get(r.city) ?? 0) + 1)
    diverse.push(r)
    if (diverse.length >= maxResults) break
  }
  return diverse
}
