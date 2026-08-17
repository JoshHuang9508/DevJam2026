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

export interface HardConstraints {
  cities?: string[]
  districts?: string[]
  budgetMin?: number
  budgetMax?: number
  minArea?: number
  minRooms?: number
  maxAge?: number
  buildingTypes?: string[]
  needElevator?: boolean
  needParking?: boolean
  maxDistToMetro?: number
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
