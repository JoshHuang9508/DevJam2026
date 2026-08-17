import { NextResponse } from 'next/server'
import { datasetSummary, listingsDbAvailable } from '@/lib/backend/listings'
import type { Mode } from '@/lib/types/profile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 資料集涵蓋範圍。給後端 agent 的 describe_dataset 用。
 *
 * 沒有這支的話，agent 被問到資料集沒涵蓋的地方只會拿到 0 筆，然後把原因猜成
 * 「條件太嚴」去建議使用者放寬預算 —— 但真正的原因是那裡根本沒有資料，
 * 放寬多少都不會有結果。這兩種情況要給使用者的下一步完全不同。
 */
export async function GET(request: Request): Promise<Response> {
  if (!listingsDbAvailable()) {
    return NextResponse.json({ error: '物件資料庫尚未建立' }, { status: 503 })
  }
  const raw = new URL(request.url).searchParams.get('mode')
  const mode: Mode = raw === 'rent' ? 'rent' : 'sale'
  const summary = datasetSummary(mode)

  return NextResponse.json({
    ...summary,
    priceUnit: mode === 'sale' ? '萬元（總價）' : '元／月',
    source: '內政部實價登錄成交紀錄，非現售房源',
  })
}
