import type { ScoredListing } from '@/lib/types/listing'
import { WEIGHT_KEYS, WEIGHT_LABELS } from '@/lib/types/profile'
import { StarRating } from './StarRating'

export function ListingScoreSummary({ listing, rank }: { listing: ScoredListing; rank: number }) {
  return (
    <>
      <p className="text-[11px] text-neutral-500">第 {rank} 名 · {listing.city}{listing.district}</p>
      <h2 className="mt-1 break-words text-base font-semibold leading-snug text-bark">{listing.title}</h2>
      <div className="mt-3 border-t border-mist pt-3">
        <p className="text-xs text-neutral-500">整體評分</p>
        <div className="mt-1"><StarRating score={listing.score} size="large" /></div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-mist pt-3">
        {WEIGHT_KEYS.map((key) => (
          <div key={key} className="min-w-0">
            <dt className="text-[11px] text-neutral-500">{WEIGHT_LABELS[key]}</dt>
            <dd className="text-[13px] leading-tight text-ink">
              <StarRating score={listing.breakdown[key].subscore} size="compact" />
            </dd>
          </div>
        ))}
      </dl>
    </>
  )
}
