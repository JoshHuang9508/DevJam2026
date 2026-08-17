'use client'

import { useCallback, useRef, useState } from 'react'
import type { ScoredListing } from '@/lib/types/listing'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'

/**
 * 一次查幾筆。這是**全範圍**的前 N 名，與地圖視角無關 ——
 * 拖地圖不會重新查詢，只是讓地圖少畫幾個視角外的圖釘（見 MapView）。
 */
const RESULT_LIMIT = 50

export function useSearchState() {
  // 重整就是一次全新的搜尋：profile 不落地。留著它會讓重整後畫面回到入口、
  // 列表卻還掛著上一輪的條件與結果，而使用者沒有任何線索知道那是哪來的。
  const [profile, setProfileState] = useState<SearchProfile>(DEFAULT_PROFILE)
  const [results, setResults] = useState<ScoredListing[]>([])
  const [relaxations, setRelaxations] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const requestSeq = useRef(0)
  // 相機要不要跟著結果移動。查詢不再由拖地圖觸發，所以每次查詢都是「新的搜尋」，
  // fitBounds 也就不會再跟使用者的相機互搶。
  const [fitToken, setFitToken] = useState(0)

  const setProfile = useCallback((next: SearchProfile) => { setProfileState(next) }, [])

  const rank = useCallback(async (target: SearchProfile) => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/rank', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: target, limit: RESULT_LIMIT }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { results: ScoredListing[]; relaxations: string[] }
      // 舊請求的回應不得覆蓋新結果
      if (seq !== requestSeq.current) return
      setResults(data.results)
      setRelaxations(data.relaxations)
      setFitToken((n) => n + 1)
    } catch {
      if (seq !== requestSeq.current) return
      setError('排序失敗，請稍後再試')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [])

  return {
    profile, setProfile,
    results, setResults,
    relaxations, setRelaxations,
    loading, error,
    hoveredId, setHoveredId,
    rank, fitToken,
  }
}
