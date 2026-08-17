'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { parseProfile } from '@/lib/profile/schema'
import type { ScoredListing } from '@/lib/types/listing'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'

const STORAGE_KEY = 'housing-agent.profile.v1'

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

  // localStorage 只能在掛載後讀取，避免 SSR / CSR 內容不一致
  useEffect(() => { setProfileState(loadStoredProfile()) }, [])

  const setProfile = useCallback((next: SearchProfile) => {
    setProfileState(next)
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* 無痕模式可忽略 */ }
  }, [])

  const rank = useCallback(async (target: SearchProfile) => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/rank', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: target }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { results: ScoredListing[]; relaxations: string[] }
      // 舊請求的回應不得覆蓋新結果
      if (seq !== requestSeq.current) return
      setResults(data.results)
      setRelaxations(data.relaxations)
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
    rank,
  }
}
