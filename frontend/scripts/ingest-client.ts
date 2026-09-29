import { randomUUID } from 'node:crypto'

export interface GeocodeResult {
  lat: number
  lng: number
  source: 'nominatim'
  precision: 'exact' | 'approximate'
  matchedAddress: string | null
}

export async function geocodeAddresses(addresses: string[]): Promise<Array<GeocodeResult | null>> {
  const ingestUrl = (process.env.INGEST_URL ?? 'http://127.0.0.1:3001/listings/ingest').replace(/\/$/, '')
  const baseUrl = ingestUrl.replace(/\/listings\/ingest$/, '')
  const runId = randomUUID()
  const results: Array<GeocodeResult | null> = []
  try {
    for (let index = 0; index < addresses.length; index += 50) {
      const response = await post<{ results: Array<GeocodeResult | null> }>(`${baseUrl}/geocoding/lookup`, { runId, addresses: addresses.slice(index, index + 50) })
      results.push(...response.results)
    }
    return results
  } finally {
    await post(`${baseUrl}/geocoding/complete`, { runId }).catch(() => undefined)
  }
}

export async function ingestListings(source: string, items: unknown[], options: { onlyIfEmpty?: boolean } = {}): Promise<{ updated: number; skipped: number; deleted: number }> {
  const baseUrl = (process.env.INGEST_URL ?? 'http://127.0.0.1:3001/listings/ingest').replace(/\/$/, '')
  if (options.onlyIfEmpty) {
    const status = await get<{ total: number }>(baseUrl.replace(/\/ingest$/, '/status'))
    if (status.total > 0) return { updated: 0, skipped: items.length, deleted: 0 }
  }
  const runId = randomUUID()
  let updated = 0
  let skipped = 0
  for (let index = 0; index < items.length; index += 50) {
    const result = await post<{ updated: number; skipped: number }>(baseUrl, { runId, items: items.slice(index, index + 50) })
    updated += result.updated
    skipped += result.skipped
  }
  const completed = await post<{ deleted: number }>(`${baseUrl}/complete`, { runId, source })
  return { updated, skipped, deleted: completed.deleted }
}

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} 回應 ${response.status}: ${(await response.text()).slice(0, 500)}`)
  return response.json() as Promise<T>
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`${url} 回應 ${response.status}: ${(await response.text()).slice(0, 500)}`)
  return response.json() as Promise<T>
}
