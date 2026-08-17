import type { ScoredListing } from '@/lib/types/listing'
import { WEIGHT_KEYS, WEIGHT_LABELS } from '@/lib/types/profile'

/** 條狀圖長度以「該維度的貢獻佔總分比例」表示，讓權重的影響直接看得見 */
export function BreakdownBars({ listing }: { listing: ScoredListing }) {
  const total = listing.score || 1
  return (
    <ul className="space-y-1">
      {WEIGHT_KEYS.map((key) => {
        const b = listing.breakdown[key]
        const pct = Math.round((b.contribution / total) * 100)
        return (
          <li key={key} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 text-neutral-500">{WEIGHT_LABELS[key]}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
              <span
                className="block h-full rounded-full bg-blue-600"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="w-8 shrink-0 text-right tabular-nums text-neutral-500">{pct}%</span>
          </li>
        )
      })}
    </ul>
  )
}
