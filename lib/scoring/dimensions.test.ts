import { describe, expect, it } from 'vitest'
import { DIMENSIONS } from './dimensions'
import { fillDataGaps } from './gaps'
import { makeListing } from '@/lib/test-utils/factory'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'
import type { ListingWithFeatures } from '@/lib/types/listing'

const fill = (l: ListingWithFeatures) => fillDataGaps([l])[0]
const profile = (o: Partial<SearchProfile> = {}): SearchProfile => ({ ...DEFAULT_PROFILE, ...o })

describe('DIMENSIONS.price', () => {
  it('百分位越低分數越高', () => {
    const cheap = DIMENSIONS.price(fill(makeListing({ features: { pricePercentile: 0.1 } })), profile())
    const pricey = DIMENSIONS.price(fill(makeListing({ features: { pricePercentile: 0.9 } })), profile())
    expect(cheap).toBeGreaterThan(pricey)
  })

  it('有 budgetMax 也不改變公式（單調性不變量）', () => {
    const p = profile({ hard: { budgetMax: 3000 } })
    const cheap = DIMENSIONS.price(fill(makeListing({ features: { pricePercentile: 0.1 } })), p)
    const pricey = DIMENSIONS.price(fill(makeListing({ features: { pricePercentile: 0.9 } })), p)
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

describe('DIMENSIONS 完整性', () => {
  it('六個維度都存在且回傳有限數值', () => {
    const f = fill(makeListing())
    for (const key of ['price', 'weather', 'location', 'amenities', 'space', 'quality'] as const) {
      const v = DIMENSIONS[key](f, profile())
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})
