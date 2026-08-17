import { NextResponse } from 'next/server'
import { loadPool } from '@/lib/db/client'
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

  const profile = parseProfile((body as { profile?: unknown } | null)?.profile)

  try {
    const pool = loadPool(profile.mode, profile.hard.cities)
    return NextResponse.json(rankWithRelaxation(profile, pool))
  } catch (error) {
    console.error('[api/rank] 排序失敗', error)
    return NextResponse.json({ error: '資料庫尚未建立，請先執行 pnpm db:push && pnpm db:seed' }, { status: 500 })
  }
}
