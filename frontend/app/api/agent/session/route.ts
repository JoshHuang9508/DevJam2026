import { NextResponse } from 'next/server'
import { getHealth } from '@/lib/backend/client'
import { listingsDbAvailable } from '@/lib/backend/listings'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Status probe for the header badge. Sessions themselves are created lazily by
 * /api/selector/chat, so the page renders without a backend round trip.
 */
export async function GET() {
  const health = await getHealth().catch(() => null)
  return NextResponse.json({
    backendUp: health !== null,
    // "pi-agent-core" = real LLM, "deterministic-fallback" = rule-based parser.
    agentRuntime: health?.runtime ?? null,
    listingsDb: listingsDbAvailable(),
  })
}
