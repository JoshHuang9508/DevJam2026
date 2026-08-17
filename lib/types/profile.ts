export type Mode = 'sale' | 'rent'

export type WeightKey =
  | 'price'
  | 'weather'
  | 'location'
  | 'amenities'
  | 'space'
  | 'quality'

export const WEIGHT_KEYS: readonly WeightKey[] = [
  'price', 'weather', 'location', 'amenities', 'space', 'quality',
] as const

export const WEIGHT_LABELS: Record<WeightKey, string> = {
  price: '房屋價位',
  weather: '天氣環境',
  location: '地理位置',
  amenities: '生活機能',
  space: '坪數格局',
  quality: '屋況條件',
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
  weights: { price: 50, weather: 50, location: 50, amenities: 50, space: 50, quality: 50 },
  hard: {},
  soft: {},
  notes: [],
}
