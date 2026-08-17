import { NextResponse } from 'next/server'
import { loadPool } from '@/lib/db/client'
import { compressedJson } from '@/lib/http/compress'
import { parseProfile } from '@/lib/profile/schema'
import type { MapBounds } from '@/lib/scoring'
import { rankWithRelaxation } from '@/lib/scoring/relax'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }

  const raw = body as { profile?: unknown; bounds?: MapBounds; limit?: number } | null
  const profile = parseProfile(raw?.profile)
  // 地圖視角。給了就只回視角內的結果，但分數仍以全池正規化（見 lib/scoring）。
  const bounds = parseBounds(raw?.bounds)
  const limit = Number.isFinite(raw?.limit) ? Math.min(Math.max(Number(raw?.limit), 1), 500) : undefined

  try {
    const pool = loadPool(profile.mode, profile.hard.cities)
    const ranked = rankWithRelaxation(profile, pool, {
      ...(bounds ? { bounds } : {}),
      ...(limit ? { limit } : {}),
    })
    // 200 筆帶著 35 個 feature 與 8 維 breakdown 約 480 KB，壓縮後掉到十分之一。
    return compressedJson(ranked, request)
  } catch (error) {
    console.error('[api/rank] 排序失敗', error)
    return NextResponse.json({ error: '資料庫尚未建立，請先執行 pnpm db:push && pnpm db:seed' }, { status: 500 })
  }
}

/** 只接受四個角都是有限數字的 bounds，否則當成沒給 —— 半殘的 bounds 會篩掉全部結果。 */
function parseBounds(input: unknown): MapBounds | null {
  if (!input || typeof input !== 'object') return null
  const b = input as Record<string, unknown>
  const nums = ['south', 'west', 'north', 'east'].map((k) => Number(b[k]))
  if (!nums.every(Number.isFinite)) return null
  const [south, west, north, east] = nums
  if (south > north) return null
  return { south, west, north, east }
}
