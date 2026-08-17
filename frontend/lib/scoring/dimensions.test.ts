import { describe, expect, it } from 'vitest'
import { DIMENSIONS } from './dimensions'
import { FENGSHUI_UNKNOWN_RISK, auditFengshui } from '@/lib/fengshui/audit'
import { fillDataGaps } from './gaps'
import { makeListing } from '@/lib/test-utils/factory'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'
import type { ListingWithFeatures } from '@/lib/types/listing'
import type { FengshuiEvidence } from '@/lib/types/fengshui'

const fill = (l: ListingWithFeatures) => fillDataGaps([l])[0]
const profile = (o: Partial<SearchProfile> = {}): SearchProfile => ({ ...DEFAULT_PROFILE, ...o })

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

describe('DIMENSIONS.fengshui', () => {
  it('六項全無虞的分數高於全命中', () => {
    const clear = DIMENSIONS.fengshui(fill(makeListing({ features: FS_CLEAR })), profile())
    const bad = DIMENSIONS.fengshui(fill(makeListing({ features: FS_BAD })), profile())
    expect(clear).toBe(1)
    expect(bad).toBe(0)
    expect(clear).toBeGreaterThan(bad)
  })

  it('命中項目越多分數越低（單調）', () => {
    const one = DIMENSIONS.fengshui(
      fill(makeListing({ features: { ...FS_CLEAR, fsToiletFacingDoor: 1 } })), profile())
    const two = DIMENSIONS.fengshui(
      fill(makeListing({ features: { ...FS_CLEAR, fsToiletFacingDoor: 1, fsBeamOverBed: 1 } })), profile())
    expect(one).toBeLessThan(1)
    expect(two).toBeLessThan(one)
  })

  it('嚴重度越高的項目扣越多：穿堂煞重於明堂狹窄', () => {
    const draft = DIMENSIONS.fengshui(
      fill(makeListing({ features: { ...FS_CLEAR, fsEntryWindowAligned: 1 } })), profile())
    const hall = DIMENSIONS.fengshui(
      fill(makeListing({ features: { ...FS_CLEAR, fsDaylightBlocked: 1 } })), profile())
    expect(draft).toBeLessThan(hall)
  })

  it('已有玄關屏風時穿堂煞視為化解，不扣分', () => {
    const solved = DIMENSIONS.fengshui(
      fill(makeListing({ features: { ...FS_CLEAR, fsEntryWindowAligned: 1, fsEntryScreen: 1 } })), profile())
    expect(solved).toBe(1)
  })

  it('補值後的小數輸入仍落在 0..1 且單調', () => {
    const half = DIMENSIONS.fengshui(
      fill(makeListing({ features: { ...FS_CLEAR, fsRoadRush: 0.5 } })), profile())
    const full = DIMENSIONS.fengshui(
      fill(makeListing({ features: { ...FS_CLEAR, fsRoadRush: 1 } })), profile())
    expect(half).toBeGreaterThan(full)
    expect(half).toBeLessThan(1)
    expect(full).toBeGreaterThanOrEqual(0)
  })

  it('風水證據不影響其他維度', () => {
    const clear = fill(makeListing({ features: FS_CLEAR }))
    const bad = fill(makeListing({ features: FS_BAD }))
    for (const key of ['price', 'value', 'weather', 'location', 'amenities', 'space', 'quality'] as const) {
      expect(DIMENSIONS[key](clear, profile())).toBeCloseTo(DIMENSIONS[key](bad, profile()), 10)
    }
  })
})

describe('DIMENSIONS 完整性', () => {
  it('八個維度都存在且回傳有限數值', () => {
    const f = fill(makeListing({ features: FS_CLEAR }))
    for (const key of
      ['price', 'value', 'weather', 'location', 'amenities', 'space', 'quality', 'fengshui'] as const) {
      const v = DIMENSIONS[key](f, profile())
      expect(Number.isFinite(v)).toBe(true)
    }
  })

  /**
   * 這個維度必須讀 f.listing.features（原始）而不是 f.features（補值後）。
   * 單筆池全為 null 時 fillDataGaps 找不到中位數會補 0 —— 若改讀補值後的資料，
   * 這筆「完全沒有格局圖」的物件會拿到滿分 1，等於缺資料就送滿分、排到最前面。
   * 斷言恰好是中性值 0.5 就把這件事釘死了：讀錯來源會變成 1，測試立刻紅。
   */
  it('風水證據全缺時回落到中性分數，而不是滿分', () => {
    const f = fill(makeListing({
      features: {
        fsEntryWindowAligned: null, fsEntryScreen: null, fsStoveVisibleFromDoor: null,
        fsToiletFacingDoor: null, fsBeamOverBed: null, fsLivingRoomDepthM: null,
        fsDaylightBlocked: null, fsRoadRush: null,
      },
    }))
    expect(DIMENSIONS.fengshui(f, profile())).toBeCloseTo(FENGSHUI_UNKNOWN_RISK)
    // 對照：補值後的 features 全為 0，六條規則有五條被判成「無虞」，
    // 只有明堂狹窄因為縱深被填成 0 公尺而命中 —— 補值把「沒量到」變成
    // 「客廳只有 0 公尺深」，語意同樣壞掉。0.9 明顯不等於 0.5，讀錯來源測試就紅。
    expect(auditFengshui(f.features).score).toBeCloseTo(0.9)
  })

  it('部分未檢測的物件排在已檢測且無虞的物件之後', () => {
    const checked = fill(makeListing({ features: FS_CLEAR }))
    const partial = fill(makeListing({ features: { ...FS_CLEAR, fsRoadRush: null } }))
    expect(DIMENSIONS.fengshui(partial, profile()))
      .toBeLessThan(DIMENSIONS.fengshui(checked, profile()))
  })
})
