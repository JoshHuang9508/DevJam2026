'use client'

import type { ReactNode } from 'react'
import { formatArea, formatCommute, formatDistance, formatPrice } from '@/lib/client/format'
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
              <Detail label="地址" value={listing.address || '—'} wide />
              <Detail label={listing.mode === 'rent' ? '月租' : '總價'} value={formatPrice(listing)} />
              <Detail label="單價" value={`${listing.unitPrice.toLocaleString('zh-Hant-TW')} ${listing.mode === 'rent' ? '元／坪' : '萬／坪'}`} />
              <Detail label="坪數" value={formatArea(listing.area)} />
              <Detail label="格局" value={listing.layout || '—'} />
              <Detail label="樓層" value={`${listing.floor}／${listing.totalFloor} 樓`} />
              <Detail label="屋齡" value={`${listing.age.toFixed(0)} 年`} />
              <Detail label="建物類型" value={listing.buildingType || '—'} />
              <Detail label="電梯" value={listing.hasElevator ? '有' : '無'} />
              <Detail label="車位" value={listing.hasParking ? '有' : '無'} />
              <Detail label="最近捷運" value={formatDistance(listing.features.distToMetro)} />
              <Detail label="通勤" value={formatCommute(listing.features.commuteToCbdMin)} />
              <Detail label="夏均溫" value={listing.features.summerTemp === null ? '—' : `${listing.features.summerTemp}°C`} />
              <Detail label="年雨日" value={listing.features.rainDays === null ? '—' : `${listing.features.rainDays} 天`} />
              <Detail label="超商" value={listing.features.poiConvenience500 === null ? '—' : `${listing.features.poiConvenience500} 間`} />
              <Detail label="公園" value={listing.features.poiPark500 === null ? '—' : `${listing.features.poiPark500} 座`} />
              <Detail label="刊登來源" value={listing.source || '—'} />
            </dl>
          </div>
          {listing.url && (
            <div className="shrink-0 px-3 pb-3 pt-2">
              <a
                href={listing.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg bg-nest px-3 py-2 text-center text-xs font-semibold text-paper transition hover:bg-bark"
              >
                查看原始物件 ↗
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

function Detail({ label, value, wide = false }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 min-w-0' : 'min-w-0'}>
      <dt className="text-[11px] text-neutral-500">{label}</dt>
      <dd className="break-words text-[13px] leading-tight text-ink">{value}</dd>
    </div>
  )
}
