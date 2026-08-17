'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { ListingCardBody } from '@/components/ListingCard/ListingCard'
import type { ScoredListing } from '@/lib/types/listing'

interface Props {
  listing: ScoredListing
  /** 1-based 名次，跟列表卡片的 #n 一致 */
  rank: number
  /** 圖示在容器內的螢幕座標 */
  anchor: { x: number; y: number }
  /** 地圖容器尺寸，用來把卡片夾在可見範圍內 */
  container: { width: number; height: number }
  onHover: (id: string | null) => void
}

/** 跟列表卡片同寬（w-[18.5rem]），兩邊看起來才是同一張卡 */
const CARD_W = 296
/** 卡片與圖示的間距 */
const GAP = 14
/** 與地圖容器邊緣的最小留白 */
const EDGE = 8

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/**
 * 地圖浮動卡片：內容與列表卡片共用 ListingCardBody，只是預設收合。
 *
 * 位置用實測尺寸夾進容器，不用寫死的 CARD_H —— 展開後高度會從約 130px 長到 500px 以上，
 * 任何預估值都會讓展開的卡片被容器底部裁掉。ResizeObserver 讓展開／收合當下就重算。
 */
export function MapCard({ listing, rank, anchor, container, onHover }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [size, setSize] = useState({ width: CARD_W, height: 140 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ width: el.offsetWidth, height: el.offsetHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const maxHeight = Math.max(160, container.height - EDGE * 2)
  const height = Math.min(size.height, maxHeight)
  // 右側放不下就開左邊；再夾一次是因為左邊也可能不夠（容器比卡片還窄的行動版）
  const preferLeft = anchor.x + GAP + size.width > container.width
  const left = clamp(
    preferLeft ? anchor.x - GAP - size.width : anchor.x + GAP,
    EDGE,
    Math.max(EDGE, container.width - size.width - EDGE),
  )
  const top = clamp(anchor.y - height / 2, EDGE, Math.max(EDGE, container.height - height - EDGE))

  return (
    <div
      ref={ref}
      data-testid="map-card"
      // 游標移到卡片上時把 hover 續住，否則只是 hover（未點選）的卡片會在滑向它的途中消失，
      // 「查看詳細資料」永遠點不到。
      onMouseEnter={() => onHover(listing.id)}
      onMouseLeave={() => onHover(null)}
      style={{ left, top, width: CARD_W, maxHeight }}
      className="pointer-events-auto absolute z-50 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg"
    >
      <div className="max-h-full overflow-y-auto p-3">
        <ListingCardBody
          listing={listing}
          rank={rank}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((v) => !v)}
        />
      </div>
    </div>
  )
}
