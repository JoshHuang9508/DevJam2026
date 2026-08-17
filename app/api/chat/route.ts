import { buildExplainPrompt, streamExplanation } from '@/lib/agent/explain'
import { extractDelta } from '@/lib/agent/extract'
import { loadPool } from '@/lib/db/client'
import { mergeProfile } from '@/lib/profile/merge'
import { parseProfile } from '@/lib/profile/schema'
import { rankWithRelaxation } from '@/lib/scoring/relax'
import { sseEvent } from '@/lib/sse'
import type { ChatMessage } from '@/lib/types/chat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FALLBACK_TEXT = '我沒有完全聽懂，先用原本的條件給你結果。可以再說得具體一點，例如預算、上班地點，或你最在意哪一項。'

function parseMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((m): m is ChatMessage =>
      typeof m === 'object' && m !== null &&
      (m as ChatMessage).role !== undefined &&
      typeof (m as ChatMessage).content === 'string')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content.slice(0, 2000),
    }))
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('請求格式錯誤', { status: 400 })
  }

  const raw = body as { profile?: unknown; messages?: unknown } | null
  const currentProfile = parseProfile(raw?.profile)
  const messages = parseMessages(raw?.messages)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)))
      }

      try {
        // 1. 萃取。失敗時 extractDelta 已回空 delta，流程照常往下走。
        const delta = await extractDelta(messages, currentProfile)
        const extractionFailed = Object.keys(delta).length === 0
        const profile = mergeProfile(currentProfile, delta)
        send('profile', profile)

        // 2. 排序。資料庫問題才是真正的致命錯誤。
        const pool = loadPool(profile.mode, profile.hard.cities)
        const ranked = rankWithRelaxation(profile, pool)
        send('results', ranked)

        // 3. 解釋。串流失敗就退回固定文案，永不留白畫面。
        try {
          const prompt = buildExplainPrompt(profile, ranked.results, ranked.relaxations)
          let emitted = false
          for await (const chunk of streamExplanation(prompt)) {
            emitted = true
            send('text', { delta: chunk })
          }
          if (!emitted) send('text', { delta: FALLBACK_TEXT })
        } catch (error) {
          console.error('[api/chat] 解釋串流失敗', error)
          send('text', {
            delta: extractionFailed
              ? FALLBACK_TEXT
              : '結果已更新，不過我這次沒辦法寫出說明。你可以直接看地圖與卡片，或調整左邊的權重。',
          })
        }

        send('done', {})
      } catch (error) {
        console.error('[api/chat] 處理失敗', error)
        send('error', { message: '伺服器忙碌中，請稍後再試。你仍然可以直接調整權重來重新排序。' })
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
