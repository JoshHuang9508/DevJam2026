'use client'

import { useState } from 'react'
import { ChatPanel } from '@/components/Chat/ChatPanel'
import { Landing } from '@/components/Chat/Landing'
import { ResultStrip } from '@/components/ListingCard/ResultStrip'
import { MapView } from '@/components/MapView/MapView'
import { ModeToggle } from '@/components/ModeToggle/ModeToggle'
import { WeightPanel } from '@/components/WeightPanel/WeightPanel'
import { useChat } from '@/hooks/useChat'
import { useDebouncedEffect } from '@/hooks/useDebouncedEffect'
import { useSearchState } from '@/hooks/useSearchState'
import type { Mode } from '@/lib/types/profile'

const RANK_DEBOUNCE_MS = 200

export default function Home() {
  const search = useSearchState()
  const chat = useChat(search)
  const [started, setStarted] = useState(false)

  // 開始對話後，profile 的任何變動（含 slider 拖動）都在 debounce 後重新排序。
  // 此路徑不呼叫 Gemini — 這是「手動調權重」的第二條路徑。
  useDebouncedEffect(
    () => { if (started && !chat.streaming) void search.rank(search.profile) },
    [search.profile, started, chat.streaming],
    RANK_DEBOUNCE_MS,
  )

  const setMode = (mode: Mode) => {
    const { budgetMin: _min, budgetMax: _max, ...hard } = search.profile.hard
    search.setProfile({ ...search.profile, mode, hard })
  }

  const handleSubmit = (text: string) => {
    setStarted(true)
    void chat.send(text)
  }

  if (!started) {
    return (
      <Landing
        mode={search.profile.mode}
        onModeChange={setMode}
        onSubmit={handleSubmit}
        disabled={chat.streaming}
      />
    )
  }

  return (
    <main className="flex h-screen">
      <aside className="flex w-[400px] shrink-0 flex-col border-r border-neutral-200 bg-white">
        <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3">
          <h1 className="text-base font-bold">安家</h1>
          <ModeToggle mode={search.profile.mode} onChange={setMode} />
        </header>

        <ChatPanel messages={chat.messages} streaming={chat.streaming} onSubmit={handleSubmit} />

        <details open className="border-t border-neutral-200">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-neutral-600">
            權重面板
          </summary>
          <WeightPanel
            profile={search.profile}
            onChange={search.setProfile}
            highlighted={chat.highlighted}
          />
        </details>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2 text-xs">
          <span className="text-neutral-500">找到 {search.results.length} 筆</span>
          {search.loading && <span className="text-blue-600">排序中…</span>}
          {search.error && <span className="text-red-600">{search.error}</span>}
        </div>

        {search.relaxations.length > 0 && (
          <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            為了找到結果，{search.relaxations.join('、')}
          </p>
        )}

        <div className="min-h-0 flex-1">
          <MapView
            results={search.results}
            hoveredId={search.hoveredId}
            onHover={search.setHoveredId}
            onSelect={search.setHoveredId}
          />
        </div>

        <div className="h-64 shrink-0 border-t border-neutral-200 bg-neutral-100">
          <ResultStrip
            results={search.results}
            hoveredId={search.hoveredId}
            onHover={search.setHoveredId}
          />
        </div>
      </section>
    </main>
  )
}
