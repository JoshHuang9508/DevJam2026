'use client'

import { useCallback, useState } from 'react'
import type { ScoredListing } from '@/lib/types/listing'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'

export function useSearchState() {
  const [profile, setProfileState] = useState<SearchProfile>(DEFAULT_PROFILE)
  const [results, setResultsState] = useState<ScoredListing[]>([])
  const [relaxations, setRelaxations] = useState<string[]>([])
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [fitToken, setFitToken] = useState(0)

  const setProfile = useCallback((next: SearchProfile) => setProfileState(next), [])
  const setResults = useCallback((next: ScoredListing[]) => {
    setResultsState(next)
    setFitToken((value) => value + 1)
  }, [])

  return {
    profile,
    setProfile,
    results,
    setResults,
    relaxations,
    setRelaxations,
    hoveredId,
    setHoveredId,
    fitToken,
  }
}
