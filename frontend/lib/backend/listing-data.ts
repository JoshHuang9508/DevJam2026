import 'server-only'
import { BACKEND_URL } from './client'
import type { ListingWithFeatures } from '@/lib/types/listing'
import type { Mode } from '@/lib/types/profile'

async function read<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BACKEND_URL}${path}`, { ...init, cache: 'no-store' })
  if (!response.ok) throw new Error(`物件資料服務回應 ${response.status}`)
  return response.json() as Promise<T>
}

export async function listingsDbAvailable(): Promise<boolean> {
  try {
    const status = await read<{ available: boolean }>('/listings/status')
    return status.available
  } catch {
    return false
  }
}

export function listingRows(mode: Mode): Promise<Array<{ city: string; district: string; price: number; area: number }>> {
  return read(`/listings/rows?mode=${mode}`)
}

export function districtRows(): Promise<Array<{ city: string; name: string; lat: number; lng: number; listing_count: number }>> {
  return read('/listings/districts')
}

export async function loadPool(mode: Mode, cities?: string[]): Promise<ListingWithFeatures[]> {
  const rows = await read<Record<string, unknown>[]>('/listings/pool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, cities: cities ?? [] }),
  })
  const listingKeys = new Set(['id', 'source', 'sourceId', 'mode', 'url', 'title', 'scrapedAt', 'city', 'district', 'address', 'lat', 'lng', 'price', 'unitPrice', 'area', 'layout', 'rooms', 'floor', 'totalFloor', 'age', 'buildingType', 'hasElevator', 'hasParking'])
  return rows.map((row) => {
    const listing: Record<string, unknown> = {}
    const features: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      if (key === 'listing_id') continue
      const name = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
      if (listingKeys.has(name)) listing[name] = value
      else features[name] = value
    }
    listing.hasElevator = Boolean(listing.hasElevator)
    listing.hasParking = Boolean(listing.hasParking)
    return { ...listing, features } as unknown as ListingWithFeatures
  })
}
