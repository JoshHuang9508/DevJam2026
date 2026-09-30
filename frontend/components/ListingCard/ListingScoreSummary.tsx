import type { ScoredListing } from '@/lib/types/listing'
import { StarRating } from './StarRating'

export function ListingScoreSummary({ listing }: { listing: ScoredListing }) {
  return (
    <>
      <p className="text-[11px] text-neutral-500">{listing.view.rankLabel} · {listing.view.locationLabel}</p>
      <h2 className="mt-1 break-words text-base font-semibold leading-snug text-bark">{listing.view.title}</h2>
      <div className="mt-3 border-t border-mist pt-3">
        <p className="text-xs text-neutral-500">本次需求匹配</p>
        <div className="mt-1"><StarRating rating={{ starsText: listing.assessment.starsText, fillPercent: listing.assessment.score }} size="large" /></div>
        <p className="mt-2 text-xs leading-relaxed text-neutral-600">{listing.assessment.summary}</p>
      </div>
      {listing.assessment.strengths.map((text) => <p key={text} className="mt-2 text-[11px] leading-relaxed text-sage-dark">＋ {text}</p>)}
      {listing.assessment.tradeoffs.map((text) => <p key={text} className="text-[11px] leading-relaxed text-bark">− {text}</p>)}
    </>
  )
}
