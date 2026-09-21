import 'server-only'
import { districtRows } from './listing-data'
import { REGION_CITIES, normalizeCity, type Region } from '@/lib/types/profile'

export interface PlaceAnchor {
  lat: number
  lng: number
  radiusKm: number
  label: string
}

interface DistrictRow {
  city: string
  name: string
  lat: number
  lng: number
  listing_count: number
}

const DEFAULT_RADIUS = { district: 5, city: 20, region: 80 } as const
const PREFIXES = /^(靠近|鄰近|接近|近|在|位於|想找|要找)/
const SUFFIXES = /(附近|周邊|周圍|一帶|旁邊|那邊|這邊|附近的|左右|方圓)$/

export async function resolvePlace(query: string, radiusKm?: number): Promise<PlaceAnchor | null> {
  let raw = query.normalize('NFKC').trim()
  raw = raw.replace(PREFIXES, '').replace(SUFFIXES, '').trim()
  if (!raw) return null

  const rows = await districtRows()
  const region = (Object.keys(REGION_CITIES) as Region[]).find((value) => value === raw)
  if (region) {
    const anchor = averageOf(rows, REGION_CITIES[region].map(normalizeCity))
    if (anchor) return { ...anchor, radiusKm: radiusKm ?? DEFAULT_RADIUS.region, label: region }
  }

  const matches = rows.filter((row) => row.name.startsWith(raw))
  if (matches.length) {
    const best = matches.sort((a, b) => b.listing_count - a.listing_count)[0]
    return { lat: best.lat, lng: best.lng, radiusKm: radiusKm ?? DEFAULT_RADIUS.district, label: `${best.city}${best.name}` }
  }

  const normalized = normalizeCity(raw)
  const city = [...new Set(rows.map((row) => row.city))].find((value) => {
    const name = normalizeCity(value)
    return name === normalized || name.startsWith(normalized)
  })
  if (city) {
    const anchor = averageOf(rows, [city])
    if (anchor) return { ...anchor, radiusKm: radiusKm ?? DEFAULT_RADIUS.city, label: city }
  }
  return null
}

function averageOf(rows: DistrictRow[], cities: string[]): { lat: number; lng: number } | null {
  const wanted = new Set(cities.map(normalizeCity))
  const matches = rows.filter((row) => wanted.has(normalizeCity(row.city)))
  if (!matches.length) return null
  return {
    lat: matches.reduce((sum, row) => sum + row.lat, 0) / matches.length,
    lng: matches.reduce((sum, row) => sum + row.lng, 0) / matches.length,
  }
}
