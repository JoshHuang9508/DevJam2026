import { estimateCommuteMinutes } from '@/lib/geo'
import type { SearchProfile, WeightKey } from '@/lib/types/profile'
import type { FilledListing } from './gaps'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export type DimensionFn = (f: FilledListing, p: SearchProfile) => number

/**
 * 房屋價位。恆為 1 - pricePercentile。
 * 刻意不因 budgetMax 改變曲線 — 「貼近預算上限為佳」會破壞
 * 「拉高 price 權重 → 便宜物件排名上升」的單調性不變量。
 * 超出預算已由 hard filter 排除，物件品質由 quality/space 維度把關。
 */
const price: DimensionFn = (f) => 1 - clamp01(f.features.pricePercentile)

/** 舒適溫度區間：夏季 26°C 以下滿分、34°C 0 分；冬季 18°C 以上滿分、8°C 0 分 */
const SUMMER_BEST = 26
const SUMMER_WORST = 34
const WINTER_BEST = 18
const WINTER_WORST = 8
const AQI_WORST = 150

const weather: DimensionFn = (f, p) => {
  const x = f.features
  const summer = 1 - clamp01((x.summerTemp - SUMMER_BEST) / (SUMMER_WORST - SUMMER_BEST))
  const winter = 1 - clamp01((WINTER_BEST - x.winterTemp) / (WINTER_BEST - WINTER_WORST))
  const rain = 1 - clamp01(x.rainDays / 365)
  const humid = 1 - clamp01(x.humidity / 100)
  const air = 1 - clamp01(x.aqiMean / AQI_WORST)

  const w = { summer: 0.25, winter: 0.15, rain: 0.25, humid: 0.15, air: 0.20 }
  if (p.soft.prefersCool) w.summer = 0.45
  if (p.soft.prefersLowRain) w.rain = 0.45
  const total = w.summer + w.winter + w.rain + w.humid + w.air

  return (
    (summer * w.summer + winter * w.winter + rain * w.rain + humid * w.humid + air * w.air) / total
  )
}

/** 步行可及的軌道站距離門檻 (公尺) */
const RAIL_WALKABLE_M = 800
/** 未設定 maxMin 時的通勤時間參考上限 (分鐘) */
const DEFAULT_MAX_COMMUTE_MIN = 60

const location: DimensionFn = (f, p) => {
  const x = f.features
  const anchor = p.soft.commuteAnchor
  if (anchor) {
    const nearRail = Math.min(x.distToMetro, x.distToTrain) <= RAIL_WALKABLE_M
    const mins = estimateCommuteMinutes(f.listing.lat, f.listing.lng, anchor.lat, anchor.lng, nearRail)
    // maxMin 只是軟性轉折點：超過就趨近 0，但物件不會被排除
    return 1 - clamp01(mins / (anchor.maxMin ?? DEFAULT_MAX_COMMUTE_MIN))
  }
  const rail = Math.min(x.distToMetro, x.distToTrain)
  return 1 / (1 + rail / RAIL_WALKABLE_M)
}

const POI_CATEGORY_WEIGHTS = {
  convenience: 0.15,
  supermarket: 0.20,
  park: 0.20,
  hospital: 0.15,
  school: 0.15,
  restaurant: 0.15,
} as const

const NEAR_RING_WEIGHT = 0.65
const WIDE_RING_WEIGHT = 0.35

const amenities: DimensionFn = (f) => {
  const x = f.features
  const pairs: Array<[keyof typeof POI_CATEGORY_WEIGHTS, number, number]> = [
    ['convenience', x.poiConvenience500, x.poiConvenience1k],
    ['supermarket', x.poiSupermarket500, x.poiSupermarket1k],
    ['park', x.poiPark500, x.poiPark1k],
    ['hospital', x.poiHospital500, x.poiHospital1k],
    ['school', x.poiSchool500, x.poiSchool1k],
    ['restaurant', x.poiRestaurant500, x.poiRestaurant1k],
  ]
  let sum = 0
  for (const [cat, near, wide] of pairs) {
    sum += POI_CATEGORY_WEIGHTS[cat] *
      (Math.log1p(Math.max(0, near)) * NEAR_RING_WEIGHT +
        Math.log1p(Math.max(0, wide)) * WIDE_RING_WEIGHT)
  }
  return sum
}

/** 未指定需求時的預設坪數基準 */
const DEFAULT_AREA_NEED = { sale: 25, rent: 12 } as const
const DEFAULT_ROOMS_NEED = 2
/** 達到需求 2 倍時 areaScore 接近 1 */
const AREA_SATURATION = Math.log1p(2)

const space: DimensionFn = (f, p) => {
  const areaNeed = p.hard.minArea ?? DEFAULT_AREA_NEED[p.mode]
  const roomsNeed = p.hard.minRooms ?? DEFAULT_ROOMS_NEED
  const areaScore = clamp01(Math.log1p(f.listing.area / areaNeed) / AREA_SATURATION)
  const roomScore = clamp01(f.listing.rooms / roomsNeed)
  return 0.65 * areaScore + 0.35 * roomScore
}

/** 屋齡 40 年以上視為 0 分 */
const AGE_WORST_YEARS = 40
/** 噪音距離達 300m 視為滿分安靜 */
const QUIET_SATURATION_M = 300

const quality: DimensionFn = (f, p) => {
  const l = f.listing
  const x = f.features
  const ageScore = 1 - clamp01(l.age / AGE_WORST_YEARS)
  const floorScore = l.floor === 1 || l.floor === l.totalFloor ? 0.6 : 1
  const elevatorScore = l.hasElevator ? 1 : 0.7
  const parkingScore = l.hasParking ? 1 : 0.85
  const quietScore = (p.soft.prefersQuiet ?? 0) > 0
    ? clamp01(Math.min(x.distToMainRoad, x.distToRail) / QUIET_SATURATION_M)
    : 1

  return (
    0.35 * ageScore +
    0.15 * floorScore +
    0.15 * elevatorScore +
    0.10 * parkingScore +
    0.25 * quietScore
  )
}

export const DIMENSIONS: Record<WeightKey, DimensionFn> = {
  price, weather, location, amenities, space, quality,
}
