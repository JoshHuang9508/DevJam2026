import type { ScoredListing } from '@/lib/types/listing'
export function BreakdownBars({ listing }: { listing: ScoredListing }) {
  return (
    <ul className="space-y-1">
      {listing.view.scores.map((score) => (
          <li key={score.key} className="flex items-center gap-2 text-[11px] leading-none">
            <span className="w-14 shrink-0 truncate text-neutral-500">{score.label}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
              <span
                className={`block h-full rounded-full ${score.lead ? 'bg-nest' : 'bg-twig'}`}
                style={{ width: `${score.barPercent}%` }}
              />
            </span>
            <span className="w-14 shrink-0 text-right tabular-nums text-neutral-400">
              {score.pointsText}
            </span>
          </li>
      ))}
    </ul>
  )
}
