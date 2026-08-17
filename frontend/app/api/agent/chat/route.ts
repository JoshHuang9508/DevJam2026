import { BackendError, createSession, openMessageStream, patchPreferences } from '@/lib/backend/client'
import { areaCoverageNote, listingsDbAvailable } from '@/lib/backend/listings'
import { toPreferencePatch, toSearchProfile } from '@/lib/backend/profile-bridge'
import { rememberProfile } from '@/lib/backend/profile-cache'
import { readAgentEvents } from '@/lib/backend/sse-client'
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
 *                              └─ agent 從對話萃取條件（含使用者指定的地區）
 *                                   └─ lib/scoring 直接對物件資料集排名
 *
 * 中間沒有「選行政區」那一層了：地區只在使用者自己說出口時才成為硬條件，
 * 而且一旦成立就不會被放寬（見 lib/scoring/relax.ts）。
 *
 * Emits the same event names as /api/chat (profile / results / text / done / error)
 * plus `session`, so the UI reducer is shared.
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

      /**
       * PreferenceState -> 物件排名。使用者指定的地區在這裡是不可協商的：查不到就
       * 回一句說明，不再像以前那樣把行政區條件刪掉改成全域搜尋。
       */
      const rankListings = (profile: SearchProfile): { ranked: RankResult; note: string | null } => ({
        ranked: rankWithRelaxation(profile, loadPool(profile.mode, profile.hard.cities)),
        note: areaCoverageNote(profile.mode, profile.hard),
      })

      const emit = (profile: SearchProfile) => {
        const { ranked, note } = rankListings(profile)
        send('profile', profile)
        send('results', {
          ...ranked,
          relaxations: note ? [note, ...ranked.relaxations] : ranked.relaxations,
        })
      }

      let sessionId = raw?.sessionId
      try {
        const preferencePatch = toPreferencePatch(clientProfile)
        if (!sessionId) {
          sessionId = (await createSession()).id
          await patchPreferences(sessionId, preferencePatch)
        } else {
          try {
            await patchPreferences(sessionId, preferencePatch)
          } catch (error) {
            if (!(error instanceof BackendError) || error.status !== 404) throw error
            sessionId = (await createSession()).id
            await patchPreferences(sessionId, preferencePatch)
          }
        }
        send('session', { sessionId })
        // agent 的 rank_listings 會回打 /api/rank/preferences，那裡需要這份 client profile
        // 當 base，否則它排出來的前三名跟畫面上的卡片會不一致（見 profile-cache）。
        rememberProfile(sessionId, clientProfile)

        if (!listingsDbAvailable()) {
          send('error', { message: '物件資料庫尚未建立，請先執行 pnpm db:push && pnpm db:seed。' })
        }

        const upstream = await openMessageStream(sessionId, message, request.signal)
        let emittedResults = false
        let sawText = false

        for await (const event of readAgentEvents(upstream.body!, request.signal)) {
          switch (event.type) {
            // 條件一變就重排。以前是等 candidates.updated（選區完成）才排，
            // 現在沒有選區那一步，preferences 就是唯一的觸發點。
            case 'preferences.updated':
              emit(toSearchProfile(event.preferences, clientProfile))
              emittedResults = true
              break

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

        // agent 這一輪沒動條件（例如只是問「這間屋齡多少」）時仍要給畫面一份結果，
        // 否則第一輪純提問會讓地圖一直空著。
        if (!emittedResults) emit(clientProfile)

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
