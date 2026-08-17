import { fengshuiSubscore } from '@/lib/fengshui/audit'
import { estimateCommuteMinutes } from '@/lib/geo'
import type { SearchProfile, WeightKey } from '@/lib/types/profile'
import type { FilledListing } from './gaps'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export type DimensionFn = (f: FilledListing, p: SearchProfile) => number

/**
 * 房價可負擔：跨行政區的絕對單價水準。
 * 回傳 -unitPrice，下游在候選池內 min-max 正規化後即「單價越低越高分」。
 * 刻意用單價而非總價 —— 總價混入了坪數大小，單價才隔離出「這個地段多貴」；
 * 總價上限由 hard.budgetMax 這個硬條件處理，不需要在分數裡重複表達。
 */
const price: DimensionFn = (f) => -f.listing.unitPrice

/**
 * 同區性價比：同區同型態內相對便宜的程度。
 * 恆為 1 - pricePercentile，不因 budgetMax 改變曲線 ——
 * 「貼近預算上限為佳」會破壞「拉高權重 → 便宜物件排名上升」的單調性不變量。
 * 這個維度**刻意**對跨區的絕對價差失明，那是 price 的職責。
 */
const value: DimensionFn = (f) => 1 - clamp01(f.features.pricePercentile)

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

/**
 * 風水體檢分數（1 = 六項全數無虞）。判定完全交給 lib/fengshui 的確定性規則引擎，
 * 這裡只負責把它接成一個維度 —— 排序仍舊是純函式，LLM 不參與。
 *
 * 既有排序零回歸：DEFAULT_PROFILE.weights.fengshui 為 0，normalizeWeights 後這一維的
 * weight 恆為 0，contribution = subscore × 0 = 0，總分逐筆與加入本維度前相同。
 * 使用者主動說「我在意風水」把權重拉起來，這一維才開始影響名次。
 *
 * 這一維讀 f.listing.features（**未補值**的原始證據）而不是 f.features，
 * 理由見 fengshuiSubscore 的註解：旗標欄位的中位數補值會把「未檢測」變成「無虞」，
 * 讓沒有格局圖的物件排到最前面。未檢測在這裡以中性風險計入，不獎勵也不懲罰。
 */
/**
 * 災害風險。分數越高越安全。
 *
 * 淹水用**近五年實際淹水災點**而不是水利署的淹水潛勢圖：潛勢圖的使用條款明文寫
 * 「不得援引作為土地使用管制或土地開發限制的判定依據」，拿來扣某一戶的分數是踩線的；
 * 歷史災點沒有這個限制，而且對「這附近淹過水嗎」這個問題更直接。
 *
 * 兩項都是「未檢測不等於無虞」：缺值由 fillDataGaps 補中位數並記進 dataGaps，
 * 卡片上會標示，不會讓沒圖資的地區憑空拿到滿分。
 */
const FLOOD_SATURATE = 8
const hazard: DimensionFn = (f) => {
  const x = f.features
  // 500m 內 8 個以上災點就當成最差，再多的差異對決策沒有意義
  const flood = 1 - clamp01(x.floodIncidents500 / FLOOD_SATURATE)
  // 1 低 / 2 中 / 3 高 → 1 / 0.5 / 0
  const liquefaction = 1 - clamp01((x.liquefactionLevel - 1) / 2)
  return flood * 0.65 + liquefaction * 0.35
}

const fengshui: DimensionFn = (f) => fengshuiSubscore(f.listing.features)

export const DIMENSIONS: Record<WeightKey, DimensionFn> = {
  price, value, weather, location, amenities, space, quality, hazard, fengshui,
}
