import { formatArea, formatCommute, formatDistance, formatPrice } from '@/lib/client/format'
import type { ScoredListing } from '@/lib/types/listing'
import { BreakdownBars } from './BreakdownBars'

interface Props {
  listing: ScoredListing
  rank: number
  hovered: boolean
  onHover: (id: string | null) => void
}

export function ListingCard({ listing, rank, hovered, onHover }: Props) {
  const f = listing.features
  return (
    <article
      onMouseEnter={() => onHover(listing.id)}
      onMouseLeave={() => onHover(null)}
      data-testid="listing-card"
      className={`w-72 shrink-0 rounded-xl border bg-white p-3 transition ${
        hovered ? 'border-blue-500 shadow-lg' : 'border-neutral-200 shadow-sm'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-neutral-400">#{rank}</span>
        <span className="text-xs text-neutral-500">{listing.city}{listing.district}</span>
      </div>

      <h3 className="mt-1 truncate text-sm font-semibold">{listing.title}</h3>
      <p className="mt-1 text-lg font-bold text-blue-700">{formatPrice(listing)}</p>
      <p className="text-xs text-neutral-600">
        {formatArea(listing.area)}・{listing.layout}・屋齡 {listing.age.toFixed(0)} 年・
        {listing.floor}/{listing.totalFloor} 樓
      </p>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-neutral-600">
        <div><dt className="inline text-neutral-400">捷運 </dt><dd className="inline">{formatDistance(f.distToMetro)}</dd></div>
        <div><dt className="inline text-neutral-400">通勤 </dt><dd className="inline">{formatCommute(f.commuteToCbdMin)}</dd></div>
        <div><dt className="inline text-neutral-400">夏均溫 </dt><dd className="inline">{f.summerTemp ?? '—'}°C</dd></div>
        <div><dt className="inline text-neutral-400">雨日 </dt><dd className="inline">{f.rainDays ?? '—'} 天</dd></div>
        <div><dt className="inline text-neutral-400">超商 </dt><dd className="inline">{f.poiConvenience500 ?? '—'} 間</dd></div>
        <div><dt className="inline text-neutral-400">公園 </dt><dd className="inline">{f.poiPark500 ?? '—'} 座</dd></div>
      </dl>

      <div className="mt-3 border-t border-neutral-100 pt-2">
        <BreakdownBars listing={listing} />
      </div>

      {listing.dataGaps.length > 0 && (
        <p className="mt-2 text-[11px] text-amber-700">部分資料不足，已用同區中位數估算</p>
      )}
      <p className="mt-1 text-[11px] text-neutral-400">
        本卡片為示範資料：價格、生活機能數量為模擬值，氣候為區域參考值，通勤為估計值
      </p>
    </article>
  )
}
