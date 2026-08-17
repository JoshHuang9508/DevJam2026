import { describe, expect, it } from 'vitest'
import { MAX_PER_DISTRICT, MAX_RESULTS, normalizeWeights, score } from './index'
import { makeListing } from '@/lib/test-utils/factory'
import { DEFAULT_PROFILE, WEIGHT_KEYS, type SearchProfile, type WeightKey } from '@/lib/types/profile'
import type { FengshuiEvidence } from '@/lib/types/fengshui'

const profile = (o: Partial<SearchProfile> = {}): SearchProfile => ({ ...DEFAULT_PROFILE, ...o })
const weights = (o: Partial<Record<WeightKey, number>> = {}) => ({ ...DEFAULT_PROFILE.weights, ...o })

// 風水證據在本檔內自備：factory 屬於資料層 agent，不從這裡改它
const FS_CLEAR: FengshuiEvidence = {
  fsEntryWindowAligned: 0,
  fsEntryScreen: 0,
  fsStoveVisibleFromDoor: 0,
  fsToiletFacingDoor: 0,
  fsBeamOverBed: 0,
  fsLivingRoomDepthM: 5,
  fsDaylightBlocked: 0,
  fsRoadRush: 0,
}
const FS_BAD: FengshuiEvidence = {
  fsEntryWindowAligned: 1,
  fsEntryScreen: 0,
  fsStoveVisibleFromDoor: 1,
  fsToiletFacingDoor: 1,
  fsBeamOverBed: 1,
  fsLivingRoomDepthM: 2,
  fsDaylightBlocked: 1,
  fsRoadRush: 1,
}

describe('normalizeWeights', () => {
  it('總和為 1', () => {
    const w = normalizeWeights(weights({ price: 90, location: 10 }))
    const sum = WEIGHT_KEYS.reduce((s, k) => s + w[k], 0)
    expect(sum).toBeCloseTo(1, 10)
  })

  it('全為 0 時退回預設權重的正規化結果，風水仍是 0', () => {
    const w = normalizeWeights({
      price: 0, value: 0, weather: 0, location: 0, amenities: 0, space: 0, quality: 0, fengshui: 0,
    })
    // 無差別等權會讓一個明確設為 0 的信仰性維度拿到 1/8，違反「風水必須 opt-in」；
    // 退回 DEFAULT_PROFILE 的比例則是七維各 1/7、風水 0，與加入本功能前的等權後備一致
    expect(w.fengshui).toBe(0)
    const nonFengshui = WEIGHT_KEYS.filter((k) => k !== 'fengshui')
    for (const k of nonFengshui) expect(w[k]).toBeCloseTo(1 / nonFengshui.length, 10)
    expect(WEIGHT_KEYS.reduce((s, k) => s + w[k], 0)).toBeCloseTo(1, 10)
  })

  it('fengshui 預設為 0，正規化後不佔任何比例', () => {
    const w = normalizeWeights(DEFAULT_PROFILE.weights)
    expect(DEFAULT_PROFILE.weights.fengshui).toBe(0)
    expect(w.fengshui).toBe(0)
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

  it('breakdown 八維齊全，且 contribution = subscore × weight', () => {
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

/**
 * 既有排序零回歸：風水維度是 opt-in 的信仰性偏好，預設權重 0。
 * 只要權重是 0，加不加這一維、物件風水好壞如何，排序與總分都必須與加入本功能前逐筆相同。
 */
describe('風水維度的零回歸保證', () => {
  /** A 風水好但同區性價比差；B 風水差但同區性價比好 —— 其餘條件完全相同 */
  const goodFengshuiPoorValue = makeListing({
    id: 'A', features: { ...FS_CLEAR, pricePercentile: 0.9 },
  })
  const badFengshuiGoodValue = makeListing({
    id: 'B', features: { ...FS_BAD, pricePercentile: 0.1 },
  })
  const pool = [goodFengshuiPoorValue, badFengshuiGoodValue]

  it('權重 0 時順序由其他維度（value）決定，風水好的那筆不會被拉上來', () => {
    const out = score(profile(), pool)
    expect(out.map((r) => r.id)).toEqual(['B', 'A'])
  })

  it('權重 0 時 fengshui 的 contribution 恆為 0，總分只由其餘七維構成', () => {
    const out = score(profile(), pool)
    const others: WeightKey[] = ['price', 'value', 'weather', 'location', 'amenities', 'space', 'quality']
    for (const r of out) {
      expect(r.breakdown.fengshui.weight).toBe(0)
      expect(r.breakdown.fengshui.contribution).toBe(0)
      const sum = others.reduce((s, k) => s + r.breakdown[k].contribution, 0)
      expect(r.score).toBeCloseTo(sum, 10)
    }
  })

  it('權重 0 時把兩筆的風水證據對調，分數與順序逐筆不變', () => {
    const before = score(profile(), pool)
    const swapped = score(profile(), [
      makeListing({ id: 'A', features: { ...FS_BAD, pricePercentile: 0.9 } }),
      makeListing({ id: 'B', features: { ...FS_CLEAR, pricePercentile: 0.1 } }),
    ])
    expect(swapped.map((r) => r.id)).toEqual(before.map((r) => r.id))
    for (let i = 0; i < before.length; i++) {
      expect(swapped[i].score).toBeCloseTo(before[i].score, 10)
    }
  })

  it('使用者主動把風水權重拉高後，順序才會翻轉（opt-in 生效）', () => {
    const out = score(profile({
      weights: weights({
        price: 0, value: 5, weather: 0, location: 0, amenities: 0, space: 0, quality: 0, fengshui: 95,
      }),
    }), pool)
    expect(out.map((r) => r.id)).toEqual(['A', 'B'])
  })
})
