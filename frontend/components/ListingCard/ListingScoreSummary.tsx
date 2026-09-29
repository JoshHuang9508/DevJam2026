import type { ScoredListing } from '@/lib/types/listing'
import { StarRating } from './StarRating'

export function ListingScoreSummary({ listing }: { listing: ScoredListing }) {
  return (
    <>
      <p className="text-[11px] text-neutral-500">{listing.view.rankLabel} · {listing.view.locationLabel}</p>
      <h2 className="mt-1 break-words text-base font-semibold leading-snug text-bark">{listing.title}</h2>
      <div className="mt-3 border-t border-mist pt-3">
        <p className="text-xs text-neutral-500">{listing.view.score.label}</p>
        <div className="mt-1"><StarRating rating={listing.view.score} size="large" /></div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-mist pt-3">
        {listing.view.scores.map((score) => (
          <div key={score.key} className="min-w-0">
            <dt className="text-[11px] text-neutral-500">{score.label}</dt>
            <dd className="text-[13px] leading-tight text-ink">
              <StarRating rating={score} size="compact" />
            </dd>
          </div>
        ))}
      </dl>
    </>
  )
}
