import 'server-only'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import * as schema from '@/lib/db/schema'
import type { Mode } from '@/lib/types/profile'

/**
 * Districts the seed actually covers, per mode. The backend ranks all 32 fixture
 * districts nationwide but data/app.db only holds 臺北市/新北市 listings, so the
 * 選區 result has to be intersected with this before it becomes a hard filter —
 * otherwise the listing search returns nothing and the relaxation ladder reports
 * a misleading "放寬預算" instead of the real reason.
 */
export function districtsWithListings(mode: Mode): Set<string> {
  try {
    const rows = getDb()
      .selectDistinct({ district: schema.listings.district })
      .from(schema.listings)
      .where(eq(schema.listings.mode, mode))
      .all()
    return new Set(rows.map((row) => row.district))
  } catch {
    return new Set()
  }
}

/** True when data/app.db exists and can be opened. */
export function listingsDbAvailable(): boolean {
  try {
    getDb()
    return true
  } catch {
    return false
  }
}
