import { NextResponse } from 'next/server'
import { getHealth, getListingsStatus } from '@/lib/backend/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Status probe for the header badge. Sessions themselves are created lazily by
 * /api/selector/chat, so the page renders without a backend round trip.
 */
export async function GET() {
  const health = await getHealth().catch(() => null)
  const listings = await getListingsStatus().catch(() => ({ available: false, total: 0 }))
  return NextResponse.json({
    backendUp: health !== null,
    // "pi-agent-core" = real LLM, "deterministic-fallback" = rule-based parser.
    agentRuntime: health?.runtime ?? null,
    listingsDb: Boolean(listings.available),
  })
}
