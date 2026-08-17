'use client'

import { useCallback, useRef, useState } from 'react'
import { parseSseChunk } from '@/lib/client/sseClient'
import { parseProfile } from '@/lib/profile/schema'
import type { RankResult } from '@/lib/types/listing'
import type { ChatMessage } from '@/lib/types/chat'
import { WEIGHT_KEYS, type SearchProfile, type WeightKey } from '@/lib/types/profile'
import type { useSearchState } from './useSearchState'

export type WeightHighlights = Partial<Record<WeightKey, { from: number; to: number }>>

const HIGHLIGHT_DURATION_MS = 6000

function diffWeights(before: SearchProfile, after: SearchProfile): WeightHighlights {
  const out: WeightHighlights = {}
  for (const k of WEIGHT_KEYS) {
    if (before.weights[k] !== after.weights[k]) {
      out[k] = { from: before.weights[k], to: after.weights[k] }
    }
  }
  return out
}

export function useChat(search: ReturnType<typeof useSearchState>) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [highlighted, setHighlighted] = useState<WeightHighlights>({})
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 記下對話路徑套用的那個 profile 物件。SSE 的 results 事件已經連同排序結果一起回來了，
  // 主畫面靠比對這個參考來跳過一次多餘的 /api/rank。
  const appliedByChat = useRef<SearchProfile | null>(null)

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || streaming) return

    const history: ChatMessage[] = [...messages, { role: 'user', content: trimmed }]
    setMessages([...history, { role: 'assistant', content: '' }])
    setStreaming(true)

    const before = search.profile

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: before, messages: history }),
      })
      if (!res.body) throw new Error('沒有回應串流')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let assistantText = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = parseSseChunk(buffer)
        buffer = rest

        for (const e of events) {
          if (e.event === 'profile') {
            const next = parseProfile(e.data)
            appliedByChat.current = next
            search.setProfile(next)
            const diff = diffWeights(before, next)
            if (Object.keys(diff).length > 0) {
              setHighlighted(diff)
              if (highlightTimer.current) clearTimeout(highlightTimer.current)
              highlightTimer.current = setTimeout(() => setHighlighted({}), HIGHLIGHT_DURATION_MS)
            }
          } else if (e.event === 'results') {
            const r = e.data as RankResult
            search.setResults(r.results)
            search.setRelaxations(r.relaxations)
          } else if (e.event === 'text') {
            assistantText += (e.data as { delta: string }).delta
            setMessages([...history, { role: 'assistant', content: assistantText }])
          } else if (e.event === 'error') {
            assistantText = (e.data as { message: string }).message
            setMessages([...history, { role: 'assistant', content: assistantText }])
          }
        }
      }

      if (!assistantText) {
        setMessages([...history, { role: 'assistant', content: '連線中斷了，請再說一次。' }])
      }
    } catch {
      setMessages([...history, { role: 'assistant', content: '連線失敗，請稍後再試。你仍然可以直接調整左邊的權重。' }])
    } finally {
      setStreaming(false)
    }
  }, [messages, search, streaming])

  return { messages, streaming, send, highlighted, appliedByChat }
}
