'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { parseProfile } from '@/lib/profile/schema'
import type { MapBounds } from '@/lib/scoring'
import type { ScoredListing } from '@/lib/types/listing'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'

const STORAGE_KEY = 'housing-agent.profile.v1'

/** 一個視角內最多回幾筆。DOM marker 在這個量級順暢。 */
const MAP_LIMIT = 200

function loadStoredProfile(): SearchProfile {
  if (typeof window === 'undefined') return DEFAULT_PROFILE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? parseProfile(JSON.parse(raw)) : DEFAULT_PROFILE
  } catch {
    return DEFAULT_PROFILE
  }
}

export function useSearchState() {
  const [profile, setProfileState] = useState<SearchProfile>(DEFAULT_PROFILE)
  const [results, setResults] = useState<ScoredListing[]>([])
  const [relaxations, setRelaxations] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const requestSeq = useRef(0)
  // 相機要不要跟著結果移動。只有「新的搜尋」才該 fitBounds；
  // 使用者自己拖地圖造成的重新查詢如果也 fitBounds，相機會被搶走，
  // 而且 fitBounds 又觸發下一次查詢 —— 直接進無限迴圈。
  const [fitToken, setFitToken] = useState(0)
  const lastBounds = useRef<MapBounds | null>(null)
  const lastProfile = useRef<SearchProfile | null>(null)

  // localStorage 只能在掛載後讀取，避免 SSR / CSR 內容不一致
  useEffect(() => { setProfileState(loadStoredProfile()) }, [])

  const setProfile = useCallback((next: SearchProfile) => {
    setProfileState(next)
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* 無痕模式可忽略 */ }
  }, [])

  const rank = useCallback(async (target: SearchProfile, opts: { bounds?: MapBounds | null; keepCamera?: boolean } = {}) => {
    const seq = ++requestSeq.current
    // bounds 沒給就沿用上一次的，這樣改權重時不會突然跳回全國視角
    const bounds = opts.bounds !== undefined ? opts.bounds : lastBounds.current
    lastBounds.current = bounds ?? null
    lastProfile.current = target
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/rank', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: target, bounds: bounds ?? undefined, limit: MAP_LIMIT }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { results: ScoredListing[]; relaxations: string[] }
      // 舊請求的回應不得覆蓋新結果
      if (seq !== requestSeq.current) return
      setResults(data.results)
      setRelaxations(data.relaxations)
      if (!opts.keepCamera) setFitToken((n) => n + 1)
    } catch {
      if (seq !== requestSeq.current) return
      setError('排序失敗，請稍後再試')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [])

  /** 地圖視角改變。只換結果，不動相機。 */
  const rankInBounds = useCallback((bounds: MapBounds) => {
    const target = lastProfile.current
    if (!target) return
    void rank(target, { bounds, keepCamera: true })
  }, [rank])

  return {
    profile, setProfile,
    results, setResults,
    relaxations, setRelaxations,
    loading, error,
    hoveredId, setHoveredId,
    rank, rankInBounds, fitToken,
  }
}
