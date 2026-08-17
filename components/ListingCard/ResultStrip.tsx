import type { ScoredListing } from '@/lib/types/listing'
import { ListingCard } from './ListingCard'

interface Props {
  results: ScoredListing[]
  hoveredId: string | null
  onHover: (id: string | null) => void
}

export function ResultStrip({ results, hoveredId, onHover }: Props) {
  if (results.length === 0) {
    return (
      <p className="p-4 text-sm text-neutral-500">
        還沒有結果。描述一下你想要的生活，或直接調整權重面板。
      </p>
    )
  }
  return (
    <div className="flex h-full gap-3 overflow-x-auto p-3">
      {results.map((r, i) => (
        <ListingCard
          key={r.id}
          listing={r}
          rank={i + 1}
          hovered={r.id === hoveredId}
          onHover={onHover}
        />
      ))}
    </div>
  )
}
