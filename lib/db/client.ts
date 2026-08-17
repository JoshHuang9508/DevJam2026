import 'server-only'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { and, eq, inArray } from 'drizzle-orm'
import * as schema from './schema'
import type { Mode } from '@/lib/types/profile'
import type { ListingFeatures, ListingWithFeatures } from '@/lib/types/listing'

const DB_PATH = process.env.DATABASE_PATH ?? './data/app.db'

let cached: ReturnType<typeof drizzle> | null = null

export function getDb() {
  if (!cached) {
    // 唯讀連線不得設定 journal_mode —— 那是寫入操作，會拋
    // SqliteError: attempt to write a readonly database。讀取端沿用寫入端建立的模式即可。
    const sqlite = new Database(DB_PATH, { readonly: true, fileMustExist: true })
    cached = drizzle(sqlite, { schema })
  }
  return cached
}

/**
 * 載入候選池。種子資料規模（數百筆）直接全載；
 * 計畫 B 擴到六都真實資料時，此處改為以 city 分批並加上 LIMIT。
 */
export function loadPool(mode: Mode, cities?: string[]): ListingWithFeatures[] {
  const db = getDb()
  const where = cities?.length
    ? and(eq(schema.listings.mode, mode), inArray(schema.listings.city, cities))
    : eq(schema.listings.mode, mode)

  const rows = db
    .select()
    .from(schema.listings)
    .innerJoin(
      schema.listingFeatures,
      eq(schema.listings.id, schema.listingFeatures.listingId),
    )
    .where(where)
    .all()

  return rows.map((r) => {
    const { listingId: _ignored, ...features } = r.listing_features
    return { ...r.listings, features: features as ListingFeatures }
  })
}
