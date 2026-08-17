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

  // 手動調權重的第二條路徑：profile 變動後 debounce 重排，不呼叫 Gemini。
  //
  // 注意不能把 chat.streaming 放進依賴陣列：串流結束時它 true → false 的變化本身
  // 就會重排計時器，200ms 後守衛通過，於是每次對話都多打一次 /api/rank ——
  // 但那份 profile 的排序結果早就由 SSE 的 results 事件送回來了。
  // 改為比對物件參考：對話路徑套用的 profile 直接跳過。
  //
  // `started` 刻意不放進依賴陣列。若放進去，點下範例 chip 那一刻 started 從
  // false→true 本身就會改變依賴、重新起算一次 200ms 計時器；這顆計時器與
  // /api/chat 的 SSE 回合是兩條獨立時間線在賽跑——當串流跑得比 200ms 快
  // （沒有 API key 時的 fallback 正是如此），計時器會在 profile 事件把
  // appliedByChat 設好之前就到期，此時 search.profile 還是送出訊息前的舊值、
  // appliedByChat.current 還是 null，兩者必然不相等，於是照樣多打一次
  // /api/rank。經 Playwright 實測重現（見 fix report）。
  //
  // 拿掉 started 依賴後，這個 effect 只在 search.profile 的參考真的變動時
  // 才重新排程；started 仍在 closure 內讀取最新值，用來判斷「使用者是否已
  // 進入結果畫面」，只是它本身不再觸發重新排程。
  useDebouncedEffect(
    () => {
      if (!started) return
      if (search.profile === chat.appliedByChat.current) return
      void search.rank(search.profile)
    },
    [search.profile],
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
