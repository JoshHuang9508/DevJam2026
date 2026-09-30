export interface ListingFact {
  key: string
  label: string
  group: string
  value: unknown
  displayValue: string
  unit?: string
  sourceName?: string
  sourceUrl?: string
  observedAt?: string
  confidence?: number
  evidence?: string
}

export interface ListingAssessment {
  score: number
  starsText: string
  confidence: number
  summary: string
  strengths: string[]
  tradeoffs: string[]
  matchedFactKeys: string[]
  missingInformation: string[]
}

export interface ListingView {
  title: string
  rankLabel: string
  locationLabel: string
  cardFacts: Array<{ key: string; label: string; value: string; wide: boolean }>
  detailFacts: Array<{ key: string; label: string; value: string; wide: boolean; group: string }>
  marker: { label: string; title: string; color: string; size: number; zIndex: number }
  action: { label: string; url: string } | null
}

export interface ScoredListing {
  id: string
  source: { id: string; itemId: string; url: string }
  location: { address: string; lat: number; lng: number }
  facts: ListingFact[]
  assessment: ListingAssessment
  view: ListingView
}

export interface RankResult {
  results: ScoredListing[]
  relaxations: string[]
  criteria?: Array<{ description: string; importance: 'required' | 'high' | 'medium' | 'low' }>
}
