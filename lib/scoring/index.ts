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
