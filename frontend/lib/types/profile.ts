export type Mode = 'sale' | 'rent'

export const REGIONS = ['北部', '中部', '南部', '東部', '離島'] as const
export type Region = (typeof REGIONS)[number]

export interface HardConstraints {
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
  maxCommuteMinutes?: number
  near?: { lat: number; lng: number; radiusKm: number; label?: string }
}

export interface SearchProfile {
  mode: Mode
  hard: HardConstraints
  notes: string[]
}

export const DEFAULT_PROFILE: SearchProfile = { mode: 'sale', hard: {}, notes: [] }

export function normalizeCity(name: string): string {
  return name.replace(/台/g, '臺').trim()
}
