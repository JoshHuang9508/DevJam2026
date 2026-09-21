'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { ListingScoreSummary } from '@/components/ListingCard/ListingScoreSummary'
import type { ScoredListing } from '@/lib/types/listing'

interface Props {
  listing: ScoredListing
  rank: number
  anchor: { x: number; y: number }
  container: { width: number; height: number }
  onHover: (id: string | null) => void
  onViewDetails: (id: string) => void
}

const CARD_W = 296
const GAP = 14
const EDGE = 8

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

export function MapCard({ listing, rank, anchor, container, onHover, onViewDetails }: Props) {
  const ref = useRef<HTMLDivElement>(null)
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
      role="button"
      tabIndex={0}
      aria-label={`查看${listing.title}的物件資訊`}
      onMouseEnter={() => onHover(listing.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onViewDetails(listing.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onViewDetails(listing.id)
        }
      }}
      style={{ left, top, width: CARD_W, maxHeight }}
      className="pointer-events-auto absolute z-50 cursor-pointer overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
    >
      <div className="max-h-full overflow-y-auto p-3">
        <ListingScoreSummary listing={listing} rank={rank} />
      </div>
    </div>
  )
}
