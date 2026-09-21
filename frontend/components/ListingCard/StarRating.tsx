export function StarRating({ score, size = 'default' }: { score: number; size?: 'compact' | 'default' | 'large' }) {
  const stars = (score * 5).toFixed(1)
  const starSize = size === 'large' ? 'text-3xl' : size === 'compact' ? 'text-sm' : 'text-lg'
  const numberSize = size === 'large' ? 'text-sm font-semibold' : size === 'compact' ? 'text-[10px]' : 'text-[11px]'

  return (
    <span
      role="img"
      aria-label={`評分 ${stars}／5 星`}
      className={`inline-flex items-center whitespace-nowrap ${size === 'large' ? 'gap-2' : 'gap-1'}`}
    >
      <span className={`relative inline-block leading-none tracking-[-0.08em] text-neutral-300 ${starSize}`} aria-hidden="true">
        ★★★★★
        <span
          className="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap text-amber-500"
          style={{ width: `${Math.min(100, Math.max(0, score * 100))}%` }}
        >
          ★★★★★
        </span>
      </span>
      <span className={`tabular-nums text-neutral-500 ${numberSize}`}>{stars} / 5</span>
    </span>
  )
}
