'use client'

import type { ScoredListing } from '@/lib/types/listing'

interface Props {
  listing: ScoredListing | null
  open: boolean
  onToggle: () => void
}

export function ListingDetail({ listing, open, onToggle }: Props) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="展開物件細項"
        className="flex w-10 shrink-0 flex-col items-center gap-2 border-l border-mist bg-paper py-3 text-neutral-500 transition hover:text-bark"
      >
        <span aria-hidden>◀</span>
        <span className="text-[11px] [writing-mode:vertical-rl]">物件細項</span>
      </button>
    )
  }

  return (
    <aside
      data-testid="listing-detail"
      aria-label="物件細項"
      className="flex w-80 shrink-0 flex-col border-l border-mist bg-paper"
    >
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-bark">物件細項</span>
        <button
          type="button"
          onClick={onToggle}
          aria-label="收合物件細項"
          className="text-neutral-400 transition hover:text-bark"
        >
          ▶
        </button>
      </div>

      {listing ? (
        <>
          <div key={listing.id} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-3">
              {listing.view.detailFacts.map((fact) => <Detail key={fact.key} label={fact.label} value={fact.value} wide={fact.wide} />)}
            </dl>
          </div>
          {listing.view.action && (
            <div className="shrink-0 px-3 pb-3 pt-2">
              <a
                href={listing.view.action.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg bg-nest px-3 py-2 text-center text-xs font-semibold text-paper transition hover:bg-bark"
              >
                {listing.view.action.label}
              </a>
            </div>
          )}
        </>
      ) : (
        <p className="p-4 text-sm text-neutral-500">選取地圖上的物件，即可查看物件細項。</p>
      )}
    </aside>
  )
}

function Detail({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 min-w-0' : 'min-w-0'}>
      <dt className="text-[11px] text-neutral-500">{label}</dt>
      <dd className="break-words text-[13px] leading-tight text-ink">{value}</dd>
    </div>
  )
}
