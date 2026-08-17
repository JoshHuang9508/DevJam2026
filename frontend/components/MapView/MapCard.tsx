import { formatArea, formatCommute, formatDistance, formatPrice } from '@/lib/client/format'
import type { ScoredListing } from '@/lib/types/listing'

interface Props {
  listing: ScoredListing
  x: number
  y: number
  /** true 時卡片開在圖示左側（圖示太靠右） */
  flipX: boolean
  /** true 時卡片往上開（圖示太靠下） */
  flipY: boolean
  pinned: boolean
  onClose: () => void
}

export const CARD_W = 240
export const CARD_H = 150
export const CARD_GAP = 14

export function MapCard({ listing, x, y, flipX, flipY, pinned, onClose }: Props) {
  const f = listing.features
  return (
    <div
      data-testid="map-card"
      style={{
        left: flipX ? x - CARD_W - CARD_GAP : x + CARD_GAP,
        top: flipY ? y - CARD_H - CARD_GAP : y - CARD_H / 2,
        width: CARD_W,
      }}
      className="pointer-events-auto absolute z-30 rounded-xl border border-neutral-200 bg-white p-3 shadow-lg"
    >
      {pinned && (
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉"
          className="absolute right-2 top-2 text-neutral-400 transition hover:text-neutral-900"
        >
          ✕
        </button>
      )}
      <p className="text-[11px] text-neutral-500">{listing.city}{listing.district}</p>
      <p className="mt-0.5 truncate pr-4 text-sm font-semibold text-neutral-900">{listing.title}</p>
      <p className="mt-1 text-base font-bold text-neutral-900">{formatPrice(listing)}</p>
      <p className="text-xs text-neutral-600">
        {formatArea(listing.area)}・{listing.layout}・屋齡 {listing.age.toFixed(0)} 年
      </p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 text-[11px] text-neutral-600">
        <div><dt className="inline text-neutral-400">捷運 </dt><dd className="inline">{formatDistance(f.distToMetro)}</dd></div>
        <div><dt className="inline text-neutral-400">通勤 </dt><dd className="inline">{formatCommute(f.commuteToCbdMin)}</dd></div>
      </dl>
    </div>
  )
}
