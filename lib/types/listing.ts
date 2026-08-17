import type { Mode, WeightKey } from './profile'

export interface Listing {
  id: string
  source: string
  sourceId: string
  mode: Mode
  url: string
  title: string
  scrapedAt: number
  city: string
  district: string
  address: string
  lat: number
  lng: number
  /** sale: 萬元總價 / rent: 元月租 */
  price: number
  /** sale: 萬元每坪 / rent: 元每坪 */
  unitPrice: number
  area: number
  layout: string
  rooms: number
  floor: number
  totalFloor: number
  age: number
  buildingType: string
  hasElevator: boolean
  hasParking: boolean
}

export interface ListingFeatures {
  annualTemp: number | null
  summerTemp: number | null
  winterTemp: number | null
  rainDays: number | null
  humidity: number | null
  sunHours: number | null
  aqiMean: number | null

  poiConvenience500: number | null
  poiConvenience1k: number | null
  poiSupermarket500: number | null
  poiSupermarket1k: number | null
  poiSchool500: number | null
  poiSchool1k: number | null
  poiHospital500: number | null
  poiHospital1k: number | null
  poiPark500: number | null
  poiPark1k: number | null
  poiRestaurant500: number | null
  poiRestaurant1k: number | null

  distToMetro: number | null
  distToTrain: number | null
  distToBus: number | null
  commuteToCbdMin: number | null

  districtMedianUnitPrice: number | null
  /** 0..1，同 city+district+buildingType+mode 內的單價百分位 */
  pricePercentile: number | null

  distToMainRoad: number | null
  distToRail: number | null
}

export type FeatureKey = keyof ListingFeatures

export interface ListingWithFeatures extends Listing {
  features: ListingFeatures
}

export interface DimensionBreakdown {
  subscore: number
  weight: number
  contribution: number
}

export interface ScoredListing extends ListingWithFeatures {
  score: number
  breakdown: Record<WeightKey, DimensionBreakdown>
  dataGaps: string[]
}

export interface RankResult {
  results: ScoredListing[]
  /** 為了避免 0 筆而放寬的條件說明，供 agent 明確告知使用者 */
  relaxations: string[]
}
