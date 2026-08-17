import { NextResponse } from 'next/server'
import { loadPool } from '@/lib/db/client'
import { compressedJson } from '@/lib/http/compress'
import { parseProfile } from '@/lib/profile/schema'
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

  // 這支不再收 bounds：前 N 名一律是全範圍的前 N 名，地圖自己決定要畫哪幾個
  // 圖釘（見 components/MapView）。視角過濾做在後端的話，拖一下地圖就換一批
  // 「前 30 名」，同一間房子的名次與顏色跟著相機跳，清單也會整份翻掉。
  const raw = body as { profile?: unknown; limit?: number } | null
  const profile = parseProfile(raw?.profile)
  const limit = Number.isFinite(raw?.limit) ? Math.min(Math.max(Number(raw?.limit), 1), 500) : undefined

  try {
    const pool = loadPool(profile.mode, profile.hard.cities)
    const ranked = rankWithRelaxation(profile, pool, limit ? { limit } : {})
    // 200 筆帶著 35 個 feature 與 8 維 breakdown 約 480 KB，壓縮後掉到十分之一。
    return compressedJson(ranked, request)
  } catch (error) {
    console.error('[api/rank] 排序失敗', error)
    return NextResponse.json({ error: '資料庫尚未建立，請先執行 pnpm db:push && pnpm db:seed' }, { status: 500 })
  }
}
