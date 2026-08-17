'use client'

import { useEffect } from 'react'
import { MapView } from '@/components/MapView/MapView'
import { ResultStrip } from '@/components/ListingCard/ResultStrip'
import { useSearchState } from '@/hooks/useSearchState'

export default function Home() {
  const s = useSearchState()

  // 首次載入先跑一次預設排序，避免開場空畫面
  useEffect(() => { void s.rank(s.profile) }, [s.profile.mode]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2">
        <h1 className="text-base font-bold">安家</h1>
        <span className="text-xs text-neutral-500">台灣選址助手</span>
        {s.loading && <span className="text-xs text-blue-600">排序中…</span>}
        {s.error && <span className="text-xs text-red-600">{s.error}</span>}
      </header>

      {s.relaxations.length > 0 && (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          為了找到結果，{s.relaxations.join('、')}
        </p>
      )}

      <div className="min-h-0 flex-1">
        <MapView
          results={s.results}
          hoveredId={s.hoveredId}
          onHover={s.setHoveredId}
          onSelect={s.setHoveredId}
        />
      </div>

      <div className="h-64 shrink-0 border-t border-neutral-200 bg-neutral-100">
        <ResultStrip results={s.results} hoveredId={s.hoveredId} onHover={s.setHoveredId} />
      </div>
    </main>
  )
}
