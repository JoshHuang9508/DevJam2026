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
    const w = normalizeWeights({ price: 0, value: 0, weather: 0, location: 0, amenities: 0, space: 0, quality: 0 })
    for (const k of WEIGHT_KEYS) expect(w[k]).toBeCloseTo(1 / 7, 10)
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
    id: 'A', district: '土城區', price: 800, unitPrice: 31,
    features: {
      pricePercentile: 0.05,
      poiConvenience500: 1, poiConvenience1k: 2, poiSupermarket500: 0, poiSupermarket1k: 1,
      poiPark500: 0, poiPark1k: 1, poiHospital500: 0, poiHospital1k: 1,
      poiSchool500: 0, poiSchool1k: 1, poiRestaurant500: 2, poiRestaurant1k: 5,
    },
  })
  const pricyRichAmenities = makeListing({
    id: 'B', district: '大安區', price: 4000, unitPrice: 100,
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

  it('breakdown 七維齊全，且 contribution = subscore × weight', () => {
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
