export function StarRating({ rating, size = 'default' }: { rating: { starsText: string; fillPercent: number }; size?: 'compact' | 'default' | 'large' }) {
  const starSize = size === 'large' ? 'text-3xl' : size === 'compact' ? 'text-sm' : 'text-lg'
  const numberSize = size === 'large' ? 'text-sm font-semibold' : size === 'compact' ? 'text-[10px]' : 'text-[11px]'

  return (
    <span
      role="img"
      aria-label={`評分 ${rating.starsText}／5 星`}
      className={`inline-flex items-center whitespace-nowrap ${size === 'large' ? 'gap-2' : 'gap-1'}`}
    >
      <span className={`relative inline-block leading-none tracking-[-0.08em] text-neutral-300 ${starSize}`} aria-hidden="true">
        ★★★★★
        <span
          className="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap text-gold"
          style={{ width: `${rating.fillPercent}%` }}
        >
          ★★★★★
        </span>
      </span>
      <span className={`tabular-nums text-neutral-500 ${numberSize}`}>{rating.starsText} / 5</span>
    </span>
  )
}
