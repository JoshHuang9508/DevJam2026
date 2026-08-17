import { formatArea, formatCommute, formatDistance, formatPrice } from '@/lib/client/format'
import { scorePercent } from '@/lib/client/score'
import type { ScoredListing } from '@/lib/types/listing'
import { WEIGHT_LABELS, WEIGHT_KEYS, type WeightKey } from '@/lib/types/profile'
import { BreakdownBars } from './BreakdownBars'

interface Props {
  listing: ScoredListing
  rank: number
  hovered: boolean
  onHover: (id: string | null) => void
}

/** 最強與最弱的維度，用來寫出「優點 / 取捨」兩行 */
function extremes(listing: ScoredListing): { best: WeightKey; worst: WeightKey } {
  const sorted = [...WEIGHT_KEYS].sort((a, b) => listing.breakdown[b].subscore - listing.breakdown[a].subscore)
  return { best: sorted[0], worst: sorted[sorted.length - 1] }
}

export function ListingCard({ listing, rank, hovered, onHover }: Props) {
  const f = listing.features
  const { best, worst } = extremes(listing)

  return (
    <article
      onMouseEnter={() => onHover(listing.id)}
      onMouseLeave={() => onHover(null)}
      data-testid="listing-card"
      className={`w-[18.5rem] shrink-0 rounded-lg border bg-white p-3 transition ${
        hovered ? 'border-neutral-800 shadow-md' : 'border-neutral-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] text-neutral-500">#{rank} · {listing.city}{listing.district}</p>
          <p className="truncate font-semibold text-neutral-900">{listing.title}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xl font-bold leading-none tabular-nums text-neutral-900">
            {scorePercent(listing.score)}
          </p>
          <p className="text-[11px] text-neutral-500">
            {listing.dataGaps.length > 0 ? `補 ${listing.dataGaps.length} 項` : '資料完整'}
          </p>
        </div>
      </div>

      <p className="mt-1.5 text-[15px] font-semibold tabular-nums text-neutral-900">
        {formatPrice(listing)}
      </p>
      {/* 坪數/格局/屋齡/樓層放整行 —— 塞進三欄格線會在「4房2廳3衛」中間斷行 */}
      <p className="mt-1 truncate text-[11px] text-neutral-500">
        {formatArea(listing.area)}・{listing.layout}・屋齡 {listing.age.toFixed(0)} 年・
        {listing.floor}/{listing.totalFloor} 樓
      </p>

      <dl className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 text-[11px] text-neutral-600">
        <Stat label="最近捷運" value={formatDistance(f.distToMetro)} />
        <Stat label="通勤" value={formatCommute(f.commuteToCbdMin)} />
        <Stat label="夏均溫" value={f.summerTemp === null ? '—' : `${f.summerTemp}°C`} />
        <Stat label="年雨日" value={f.rainDays === null ? '—' : `${f.rainDays} 天`} />
        <Stat label="超商" value={f.poiConvenience500 === null ? '—' : `${f.poiConvenience500} 間`} />
        <Stat label="公園" value={f.poiPark500 === null ? '—' : `${f.poiPark500} 座`} />
      </dl>

      <div className="mt-2.5 space-y-1">
        <BreakdownBars listing={listing} />
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-emerald-700">
        ＋ {WEIGHT_LABELS[best]}表現較佳（{Math.round(listing.breakdown[best].subscore * 100)}）
      </p>
      <p className="text-[11px] leading-relaxed text-amber-700">
        − {WEIGHT_LABELS[worst]}相對弱（{Math.round(listing.breakdown[worst].subscore * 100)}）
      </p>
      <p className="mt-1.5 text-[10px] text-neutral-400">
        示範資料{listing.dataGaps.length > 0 && '，部分欄位以同區中位數補值'}
      </p>
    </article>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-neutral-400">{label}</dt>
      <dd className="truncate tabular-nums">{value}</dd>
    </div>
  )
}
