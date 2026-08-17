'use client'

import { ListingCard } from '@/components/ListingCard/ListingCard'
import type { ScoredListing } from '@/lib/types/listing'

interface Props {
  results: ScoredListing[]
  hoveredId: string | null
  selectedId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string | null) => void
  open: boolean
  onToggle: () => void
}

export function ListingList({ results, hoveredId, selectedId, onHover, onSelect, open, onToggle }: Props) {

  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        data-testid="listing-list-toggle"
        aria-label="展開物件列表"
        className="flex w-10 shrink-0 flex-col items-center gap-2 border-l border-neutral-200 bg-white py-3 text-neutral-500 transition hover:text-neutral-900"
      >
        <span aria-hidden>◀</span>
        <span className="text-[11px] tabular-nums [writing-mode:vertical-rl]">{results.length} 筆</span>
      </button>
    )
  }

  return (
    <aside
      data-testid="listing-list"
      className="flex w-80 shrink-0 flex-col border-l border-neutral-200 bg-neutral-50"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-3 py-2">
        <span className="text-xs text-neutral-500">
          <span className="font-medium tabular-nums text-neutral-900">{results.length}</span> 筆物件
        </span>
        <button
          type="button"
          onClick={onToggle}
          data-testid="listing-list-toggle"
          aria-label="收合物件列表"
          className="text-neutral-400 transition hover:text-neutral-900"
        >
          ▶
        </button>
      </div>

      {results.length === 0 ? (
        <p className="p-4 text-sm text-neutral-500">還沒有結果。描述一下你想要的生活，或直接調整權重。</p>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {/* 不要在外面再包一層可點擊的 div。Task 4 已經把 role="button"、onClick
              與 Enter/Space 鍵盤處理做進 ListingCard 內部，外層再包會重複觸發，
              而且在 role="button" 外面套一個可點擊 div 在無障礙上是錯的。
              hovered 與 selected 也必須分開傳，混成一個值會毀掉 Task 4 建立的兩態區分。 */}
          {results.map((r, i) => (
            <ListingCard
              key={r.id}
              listing={r}
              rank={i + 1}
              hovered={r.id === hoveredId}
              selected={r.id === selectedId}
              onHover={onHover}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </aside>
  )
}
