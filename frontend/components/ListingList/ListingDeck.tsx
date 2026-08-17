'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ListingCardBody } from '@/components/ListingCard/ListingCard'
import type { ScoredListing } from '@/lib/types/listing'

interface Props {
  results: ScoredListing[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}

/** 滑動停下多久才算「切到這一筆」。太短會在慣性滑過中途的卡片時亂送 onSelect。 */
const SETTLE_MS = 120

/**
 * 行動版物件牌組：地圖下半部一次顯示一筆，左右滑切上下一筆。
 *
 * 用原生 scroll-snap 而不是自己接 touchstart/touchmove —— 慣性、回彈、邊界阻尼
 * 全部由瀏覽器處理，手寫的版本在 iOS 上永遠差一截。代價是要自己分辨「使用者滑的」
 * 和「程式捲的」：後者（點地圖圖示 → selectedId 變 → 捲到那張）不該再回頭送 onSelect。
 */
export function ListingDeck({ results, selectedId, onSelect }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const programmatic = useRef(false)
  const settleTimer = useRef(0)
  const [index, setIndex] = useState(0)

  const scrollToIndex = useCallback((i: number, smooth: boolean) => {
    const el = trackRef.current
    if (!el) return
    const left = i * el.clientWidth
    if (Math.abs(el.scrollLeft - left) < 2) return
    programmatic.current = true
    el.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // 外部選取（點地圖圖示）→ 捲到那一張
  useEffect(() => {
    if (!selectedId) return
    const i = results.findIndex((r) => r.id === selectedId)
    if (i === -1) return
    setIndex(i)
    scrollToIndex(i, true)
  }, [selectedId, results, scrollToIndex])

  // 換一批結果就回到第一筆
  useEffect(() => {
    setIndex(0)
    scrollToIndex(0, false)
  }, [results, scrollToIndex])

  const onScroll = () => {
    const el = trackRef.current
    if (!el || el.clientWidth === 0) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    setIndex(i)
    window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      if (programmatic.current) { programmatic.current = false; return }
      const target = results[i]
      if (target && target.id !== selectedId) onSelect(target.id)
    }, SETTLE_MS)
  }

  const step = (delta: number) => {
    const next = Math.min(Math.max(index + delta, 0), results.length - 1)
    if (next === index) return
    const target = results[next]
    setIndex(next)
    scrollToIndex(next, true)
    if (target) onSelect(target.id)
  }

  if (results.length === 0) {
    return (
      <div className="flex shrink-0 items-center justify-center border-t border-neutral-200 bg-white px-4 py-6 text-center text-xs text-neutral-500">
        還沒有結果。描述一下你想要的生活，或直接調整權重。
      </div>
    )
  }

  return (
    <section
      data-testid="listing-deck"
      className="flex h-[44%] max-h-[26rem] shrink-0 flex-col border-t border-neutral-200 bg-neutral-50"
      aria-label="物件列表"
    >
      <div className="flex shrink-0 items-center justify-between px-3 py-1.5">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={index === 0}
          aria-label="上一個物件"
          className="px-2 py-1 text-neutral-500 transition disabled:opacity-25"
        >
          ◀
        </button>
        <span className="text-[11px] tabular-nums text-neutral-500">
          <span className="font-medium text-neutral-900">{index + 1}</span> / {results.length} 筆
        </span>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={index >= results.length - 1}
          aria-label="下一個物件"
          className="px-2 py-1 text-neutral-500 transition disabled:opacity-25"
        >
          ▶
        </button>
      </div>

      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {results.map((r, i) => (
          <div key={r.id} className="h-full w-full shrink-0 snap-center snap-always px-3 pb-3">
            <div
              className={`h-full overflow-y-auto rounded-lg border bg-white p-3 transition ${
                r.id === selectedId ? 'border-neutral-900' : 'border-neutral-200'
              }`}
            >
              <ListingCardBody listing={r} rank={i + 1} expanded />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
