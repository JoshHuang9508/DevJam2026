import type { ScoredListing } from '@/lib/types/listing'
import { ListingCard } from './ListingCard'

interface Props {
  results: ScoredListing[]
  hoveredId: string | null
  selectedId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string | null) => void
}

/**
 * 高度由卡片內容決定，容器不設固定高 —— 先前寫死 h-64 (256px) 而卡片更高，
 * 標題與價格整排被裁掉。讓內容撐開就不會再有對不上的問題。
 */
export function ResultStrip({ results, hoveredId, selectedId, onHover, onSelect }: Props) {
  if (results.length === 0) {
    return (
      <div className="grid min-h-[7rem] place-items-center px-6 text-center">
        <p className="max-w-sm text-sm leading-relaxed text-neutral-500">
          還沒有結果。描述一下你想要的生活，或直接調整權重面板。
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-4 pb-1 pt-2 text-[10px] leading-none text-neutral-400">
        <span>分數為本次候選池內的相對值，條長為子分數、右側為 子分數×權重</span>
        <span className="ml-auto">氣候為區域參考值，通勤為估計值</span>
      </div>
      <div className="flex items-stretch gap-3 overflow-x-auto px-4 pb-3">
        {results.map((r, i) => (
          <ListingCard
            key={r.id}
            listing={r}
            rank={i + 1}
            hovered={r.id === hoveredId}
            selected={r.id === selectedId}
            onHover={onHover}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}
