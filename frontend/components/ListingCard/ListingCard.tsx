import type { ScoredListing } from '@/lib/types/listing'
import { StarRating } from './StarRating'

interface Props {
  listing: ScoredListing
  hovered: boolean
  selected: boolean
  onHover: (id: string | null) => void
  onSelect: (id: string | null) => void
}

interface BodyProps {
  listing: ScoredListing
  expanded: boolean
}

export function ListingCardBody({ listing, expanded }: BodyProps) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] text-neutral-500">{listing.view.rankLabel} · {listing.view.locationLabel}</p>
          <p className="truncate font-semibold text-bark">{listing.view.title}</p>
        </div>
        <div className="shrink-0 text-right">
          <StarRating rating={{ starsText: listing.assessment.starsText, fillPercent: listing.assessment.score }} />
        </div>
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-600">{listing.assessment.summary}</p>

      {expanded && (
        <>
          <dl className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 text-[11px] text-neutral-600">
            {listing.view.cardFacts.map((fact) => <Stat key={fact.key} label={fact.label} value={fact.value} />)}
          </dl>

          {listing.assessment.strengths.map((text) => <p key={text} className="mt-2 text-[11px] leading-relaxed text-sage-dark">＋ {text}</p>)}
          {listing.assessment.tradeoffs.map((text) => <p key={text} className="text-[11px] leading-relaxed text-bark">− {text}</p>)}
        </>
      )}
    </>
  )
}

export function ListingCard({ listing, hovered, selected, onHover, onSelect }: Props) {
  return (
    <article
      role="button"
      tabIndex={0}
      onMouseEnter={() => onHover(listing.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(listing.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(listing.id) }
      }}
      data-testid="listing-card"
      className={`w-[18.5rem] shrink-0 cursor-pointer rounded-lg border bg-paper p-3 transition ${
        selected ? 'border-nest ring-1 ring-nest' : hovered ? 'border-twig shadow-md' : 'border-mist'
      }`}
    >
      <ListingCardBody listing={listing} expanded />
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
