import type { FengshuiIssueKey } from './fengshui'

export type Mode = 'sale' | 'rent'

export type WeightKey =
  | 'price'
  | 'value'
  | 'weather'
  | 'location'
  | 'amenities'
  | 'space'
  | 'quality'
  | 'fengshui'

export const WEIGHT_KEYS: readonly WeightKey[] = [
  'price', 'value', 'weather', 'location', 'amenities', 'space', 'quality', 'fengshui',
] as const

export const WEIGHT_LABELS: Record<WeightKey, string> = {
  price: '房價可負擔',
  value: '同區性價比',
  weather: '天氣環境',
  location: '地理位置',
  amenities: '生活機能',
  space: '坪數格局',
  quality: '屋況條件',
  fengshui: '風水',
}

export const REGIONS = ['北部', '中部', '南部', '東部', '離島'] as const
export type Region = (typeof REGIONS)[number]

/**
 * 區域 → 縣市。使用者說「我要中部」時，硬條件必須能落到縣市層級才篩得動。
 * 宜蘭歸北部（北北基宜的講法），與後端 fixture 的 region 標記一致。
 */
export const REGION_CITIES: Record<Region, string[]> = {
  北部: ['臺北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '宜蘭縣'],
  中部: ['臺中市', '苗栗縣', '彰化縣', '南投縣', '雲林縣'],
  南部: ['高雄市', '臺南市', '嘉義市', '嘉義縣', '屏東縣'],
  東部: ['花蓮縣', '臺東縣'],
  離島: ['澎湖縣', '金門縣', '連江縣'],
}

/** 「台北市」與「臺北市」是同一個地方，比對前一律正規化，否則使用者打「台」就篩不到。 */
export function normalizeCity(name: string): string {
  return name.replace(/台/g, '臺').trim()
}

export function citiesInRegions(regions: readonly Region[]): Set<string> {
  const out = new Set<string>()
  for (const r of regions) for (const c of REGION_CITIES[r] ?? []) out.add(c)
  return out
}

export interface HardConstraints {
  /** 使用者指定的區域（北部／中部…）。展開成縣市後與 cities 取交集。 */
  regions?: Region[]
  cities?: string[]
  districts?: string[]
  excludedCities?: string[]
  excludedDistricts?: string[]
  budgetMin?: number
  budgetMax?: number
  minArea?: number
  minRooms?: number
  maxAge?: number
  buildingTypes?: string[]
  needElevator?: boolean
  needParking?: boolean
  maxDistToMetro?: number
  /**
   * 「靠近某地」。使用者很少完整講出行政區名 ——「高雄附近」「靠近土城」「南部就好」
   * 都是常見說法。地標由後端用 districts 表的真實重心解析成座標，**不讓模型自己生**，
   * 那是最容易產生幻覺的地方（模型很敢給一組看起來合理但差幾十公里的經緯度）。
   */
  near?: { lat: number; lng: number; radiusKm: number; label?: string }
  /** 使用者明確表示要避開的風水忌諱 */
  avoidFengshui?: FengshuiIssueKey[]
}

export interface CommuteAnchor {
  lat: number
  lng: number
  label: string
  maxMin?: number
}

export interface SoftPrefs {
  prefersCool?: boolean
  prefersLowRain?: boolean
  prefersQuiet?: number
  commuteAnchor?: CommuteAnchor
}

export interface SearchProfile {
  mode: Mode
  weights: Record<WeightKey, number>
  hard: HardConstraints
  soft: SoftPrefs
  notes: string[]
}

export const DEFAULT_PROFILE: SearchProfile = {
  mode: 'sale',
  // fengshui 預設 0：風水是信仰性偏好，必須由使用者主動說出口才 opt-in。
  // 權重 0 在 normalizeWeights 下佔不到任何比例，對總分的貢獻恆為 0，
  // 因此未開啟風水時排序結果與加入本功能前逐筆相同（既有排序零回歸）。
  weights: { price: 50, value: 50, weather: 50, location: 50, amenities: 50, space: 50, quality: 50, fengshui: 0 },
  hard: {},
  soft: {},
  notes: [],
}
