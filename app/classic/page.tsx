'use client'

import { useState } from 'react'
import { MapView } from '@/components/MapView/MapView'
import { ModeToggle } from '@/components/ModeToggle/ModeToggle'
import { ResultStrip } from '@/components/ListingCard/ResultStrip'
import { WeightPanel } from '@/components/WeightPanel/WeightPanel'
import { useDebouncedEffect } from '@/hooks/useDebouncedEffect'
import { useSearchState } from '@/hooks/useSearchState'
import type { Mode, WeightKey } from '@/lib/types/profile'

const RANK_DEBOUNCE_MS = 200

/**
 * 純權重面板版：只用 lib/scoring 排序，沒有對話層。
 * 這是接上推薦後端之前的原始主畫面，保留下來方便單獨驗證 scoring engine。
 */
export default function Classic() {
  const s = useSearchState()
  const [highlighted] = useState<Partial<Record<WeightKey, { from: number; to: number }>>>({})

  // profile 任何變動（含 slider 拖動）都在 debounce 後重新排序；此路徑不呼叫任何模型
  useDebouncedEffect(() => { void s.rank(s.profile) }, [s.profile], RANK_DEBOUNCE_MS)

  const setMode = (mode: Mode) => {
    // 買賣與租賃的預算量級不同，切換時一併清掉
    const { budgetMin: _min, budgetMax: _max, ...hard } = s.profile.hard
    s.setProfile({ ...s.profile, mode, hard })
  }

  return (
    <main className="flex h-screen bg-neutral-50">
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-neutral-200 bg-white">
        <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3">
          <h1 className="text-[15px] font-bold tracking-tight text-neutral-900">安家</h1>
          <ModeToggle mode={s.profile.mode} onChange={setMode} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <WeightPanel profile={s.profile} onChange={s.setProfile} highlighted={highlighted} />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2 text-xs">
          <span className="text-neutral-500">
            找到 <span className="font-medium tabular-nums text-neutral-900">{s.results.length}</span> 筆
          </span>
          {s.loading && <span className="text-neutral-400">排序中…</span>}
          {s.error && <span className="text-red-600">{s.error}</span>}
        </div>

        {s.relaxations.length > 0 && (
          <p className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            為了找到結果，{s.relaxations.join('、')}
          </p>
        )}

        <div className="min-h-0 flex-1">
          <MapView results={s.results} hoveredId={s.hoveredId} onHover={s.setHoveredId} onSelect={s.setHoveredId} />
        </div>

        <div className="shrink-0 border-t border-neutral-200 bg-neutral-100">
          <ResultStrip results={s.results} hoveredId={s.hoveredId} onHover={s.setHoveredId} />
        </div>
      </section>
    </main>
  )
}
