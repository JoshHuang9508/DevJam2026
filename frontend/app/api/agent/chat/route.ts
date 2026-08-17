import { BackendError, createSession, openMessageStream, patchPreferences } from '@/lib/backend/client'
import { districtsWithListings, listingsDbAvailable } from '@/lib/backend/listings'
import { toPreferencePatch, toSearchProfile } from '@/lib/backend/profile-bridge'
import { readAgentEvents } from '@/lib/backend/sse-client'
import type { Candidate, PreferenceState } from '@/lib/backend/types'
import { loadPool } from '@/lib/db/client'
import { parseProfile } from '@/lib/profile/schema'
import { rankWithRelaxation } from '@/lib/scoring/relax'
import { sseEvent } from '@/lib/sse'
import type { RankResult } from '@/lib/types/listing'
import type { SearchProfile } from '@/lib/types/profile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * One agent turn, backend-driven.
 *
 *   client profile ──patch──> backend PreferenceState
 *                              └─ Pi agent picks 行政區 (deterministic ranking)
 *                                   └─ top districts become hard.districts
 *                                        └─ lib/scoring ranks the 物件 in them
 *
 * Emits the same event names as /api/chat (profile / results / text / done / error)
 * plus `session` and `districts`, so the UI reducer is shared.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('請求格式錯誤', { status: 400 })
  }

  const raw = body as { sessionId?: string; profile?: unknown; message?: unknown } | null
  const clientProfile = parseProfile(raw?.profile)
  const message = typeof raw?.message === 'string' ? raw.message.trim() : ''
  if (!message) return new Response('缺少 message', { status: 400 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)))
      }

      /** Districts -> listings. Runs whenever the backend publishes a new ranking. */
      const rankListings = (preferences: PreferenceState, districts: Candidate[]): {
        profile: SearchProfile
        ranked: RankResult
        note: string | null
      } => {
        let profile = toSearchProfile(preferences, districts, clientProfile)
        let note: string | null = null

        if (profile.hard.districts?.length) {
          const covered = districtsWithListings(profile.mode)
          const kept = profile.hard.districts.filter((d) => covered.has(d))
          if (kept.length === 0) {
            // Backend chose districts the seed does not cover. Drop the filter rather
            // than let the relaxation ladder blame the budget for an empty result.
            const { districts: _dropped, ...rest } = profile.hard
            profile = { ...profile, hard: rest }
            note = `後端選出的行政區（${districts.slice(0, 3).map((d) => d.city + d.district).join('、')}）目前沒有種子物件，物件清單改用其餘條件搜尋。`
          } else if (kept.length < profile.hard.districts.length) {
            profile = { ...profile, hard: { ...profile.hard, districts: kept } }
          }
        }

        return { profile, ranked: rankWithRelaxation(profile, loadPool(profile.mode, profile.hard.cities)), note }
      }

      let sessionId = raw?.sessionId
      try {
        if (!sessionId) {
          sessionId = (await createSession()).id
        }
        send('session', { sessionId })

        // Adopt whatever the user changed on the sliders before the agent runs,
        // so the agent reasons from the state the user is actually looking at.
        await patchPreferences(sessionId, toPreferencePatch(clientProfile)).catch(() => undefined)

        if (!listingsDbAvailable()) {
          send('error', { message: '物件資料庫尚未建立，請先執行 pnpm db:push && pnpm db:seed。行政區排序仍可運作。' })
        }

        const upstream = await openMessageStream(sessionId, message, request.signal)
        let latestPreferences: PreferenceState | null = null
        let emittedResults = false
        let sawText = false

        for await (const event of readAgentEvents(upstream.body!, request.signal)) {
          switch (event.type) {
            case 'preferences.updated':
              latestPreferences = event.preferences
              break

            case 'candidates.updated':
            case 'ranking.updated': {
              if (!latestPreferences) break
              send('districts', event.candidates)
              const { profile, ranked, note } = rankListings(latestPreferences, event.candidates)
              send('profile', profile)
              send('results', { ...ranked, relaxations: note ? [note, ...ranked.relaxations] : ranked.relaxations })
              emittedResults = true
              break
            }

            case 'message.delta':
              sawText = true
              send('text', { delta: event.delta })
              break

            case 'message.completed':
              // Non-streaming runtimes only emit the final message.
              if (!sawText && event.message) send('text', { delta: event.message })
              break

            case 'error':
              send('error', { message: event.message })
              break

            default:
              break
          }
        }

        send('done', {})
      } catch (error) {
        console.error('[api/selector/chat] 失敗', error)
        send('error', {
          message: error instanceof BackendError
            ? error.message
            : '伺服器連接錯誤。',
        })
        send('done', {})
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
