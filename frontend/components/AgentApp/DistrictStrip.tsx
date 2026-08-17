'use client'

import type { Candidate } from '@/lib/backend/types'

interface Props {
  districts: Candidate[]
  /** Districts actually used as the listing filter (seed coverage may narrow them). */
  active: string[]
}

/**
 * 後端 deterministic ranking engine 選出的行政區。這是「選區 → 列物件」的
 * 上游步驟，所以做得比下方的物件卡片小一號，只交代結果與理由。
 */
export function DistrictStrip({ districts, active }: Props) {
  if (districts.length === 0) return null
  const used = new Set(active)

  return (
    <section className="shrink-0 border-b border-neutral-200 bg-white px-4 py-2.5" data-testid="district-strip">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-[11px] font-semibold text-neutral-700">後端選出的行政區</h2>
        <span className="text-[11px] text-neutral-400">
          deterministic ranking engine · 深色 {used.size || districts.length} 區用於物件搜尋
        </span>
      </div>

      <div className="flex items-stretch gap-2 overflow-x-auto pb-0.5">
        {districts.slice(0, 12).map((d, i) => {
          const inUse = used.has(d.district)
          const rent = d.rawData.housing?.medianMonthlyRent
          const mrt = d.rawData.transportation?.mrtDistanceKm
          return (
            <article
              key={d.id}
              title={`${d.highlights.join('、')}${d.tradeoffs.length ? `\n取捨：${d.tradeoffs.join('、')}` : ''}`}
              className={`w-[10.5rem] shrink-0 rounded-lg border p-2 ${
                inUse ? 'border-neutral-200 bg-white' : 'border-neutral-200 bg-neutral-50 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-1.5">
                <div className="min-w-0">
                  <p className="text-[10px] text-neutral-400">#{i + 1} · {d.region}</p>
                  <p className="truncate text-xs font-semibold text-neutral-900">
                    {d.city}{d.district}
                  </p>
                </div>
                <p className="shrink-0 text-base font-bold leading-none tabular-nums text-neutral-900">
                  {d.score}
                </p>
              </div>
              <dl className="mt-1.5 flex gap-2 text-[10px] leading-none text-neutral-500">
                <div>
                  <dt className="text-neutral-400">租金</dt>
                  <dd className="mt-0.5 tabular-nums">{rent ? rent.toLocaleString('zh-TW') : '—'}</dd>
                </div>
                <div>
                  <dt className="text-neutral-400">捷運</dt>
                  <dd className="mt-0.5 tabular-nums">{mrt == null ? '無' : `${mrt} km`}</dd>
                </div>
                <div>
                  <dt className="text-neutral-400">信心</dt>
                  <dd className="mt-0.5 tabular-nums">{Math.round(d.confidence * 100)}%</dd>
                </div>
              </dl>
            </article>
          )
        })}
      </div>
    </section>
  )
}
