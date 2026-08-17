'use client'

import { useEffect, useRef } from 'react'
import type { ChatMessage } from '@/lib/types/chat'
import { Composer } from './Composer'

interface Props {
  messages: ChatMessage[]
  streaming: boolean
  onSubmit: (text: string) => void
}

export function ChatPanel({ messages, streaming, onSubmit }: Props) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" data-testid="chat-messages">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[92%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
              m.role === 'user'
                ? 'ml-auto bg-blue-600 text-white'
                : 'bg-neutral-100 text-neutral-800'
            }`}
          >
            {m.content || (streaming ? '思考中…' : '')}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="border-t border-neutral-200 p-3">
        <Composer onSubmit={onSubmit} disabled={streaming} />
      </div>
    </div>
  )
}
