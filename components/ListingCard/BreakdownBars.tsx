import type { ScoredListing } from '@/lib/types/listing'
import { WEIGHT_KEYS, WEIGHT_LABELS } from '@/lib/types/profile'

/**
 * 條長 = 該維度的子分數（0..1），右側標註 `子分數×正規化權重`。
 * 這比「貢獻佔總分的百分比」好讀 —— 百分比會把「這一項本身好不好」跟
 * 「使用者有多在意這一項」混成同一個數字，看不出是哪一邊造成的。
 */
export function BreakdownBars({ listing }: { listing: ScoredListing }) {
  const rows = WEIGHT_KEYS.map((key) => ({ key, ...listing.breakdown[key] }))
  const peak = Math.max(...rows.map((r) => r.subscore))

  return (
    <ul className="space-y-1">
      {rows.map(({ key, subscore, weight }) => {
        const lead = subscore === peak
        return (
          <li key={key} className="flex items-center gap-2 text-[11px] leading-none">
            <span className="w-14 shrink-0 truncate text-neutral-500">{WEIGHT_LABELS[key]}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
              <span
                className={`block h-full rounded-full ${lead ? 'bg-neutral-700' : 'bg-neutral-300'}`}
                style={{ width: `${Math.round(subscore * 100)}%` }}
              />
            </span>
            <span className="w-14 shrink-0 text-right tabular-nums text-neutral-400">
              {Math.round(subscore * 100)}×{weight.toFixed(2)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
