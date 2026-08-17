/**
 * TypeScript mirrors of the Fastify backend's Zod contracts (backend/src/contracts.ts).
 * Hand-written rather than generated so the frontend never imports backend runtime code;
 * regenerate from http://localhost:3001/openapi.json if the backend contract moves.
 */

export type Region = '北部' | '中部' | '南部' | '東部' | '離島'
export type DataQuality = 'observed' | 'estimated' | 'fixture' | 'missing'
export type PreferenceLevel = 'low' | 'medium' | 'high'

/** The backend's five scoring dimensions. Not the same axis set as lib/types/profile.ts. */
export type DimensionKey =
  | 'housing'
  | 'climate'
  | 'transportation'
  | 'amenities'
  | 'geography'

export const DIMENSION_KEYS: readonly DimensionKey[] = [
  'housing', 'climate', 'transportation', 'amenities', 'geography',
] as const

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  housing: '房屋價位',
  climate: '天氣環境',
  transportation: '交通位置',
  amenities: '生活機能',
  geography: '地理環境',
}

export interface SourceMetadata {
  provider: string
  sourceName: string
  sourceUrl?: string
  fetchedAt: string
  isFixture: boolean
}

export interface ClimateStats {
  averageTemperatureC: number
  summerHighC: number
  winterLowC: number
  annualRainfallMm: number
  annualRainyDays: number
  relativeHumidityPct: number
}

export interface HousingStats {
  medianMonthlyRent: number
  averageMonthlyRent: number
  sampleSize: number
  currency: 'TWD'
}

export interface AmenityStats {
  convenienceStoresPerKm2: number
  supermarketsPerKm2: number
  hospitalsPer100k: number
  clinicsPer100k: number
  restaurantsPerKm2: number
  schoolsPerKm2: number
  parksPerKm2: number
}

export interface TransportStats {
  railwayDistanceKm: number | null
  highSpeedRailDistanceKm: number | null
  mrtDistanceKm: number | null
  busStopsPerKm2: number
}

export interface GeographyStats {
  elevationM: number
  coastalDistanceKm: number
  populationDensityPerKm2: number
}

export interface ScoreBreakdownItem {
  rawScore: number | null
  weight: number
  effectiveWeight: number
  contribution: number
  available: boolean
  reason: string
}

export interface Candidate {
  id: string
  region: Region
  city: string
  district: string
  latitude: number
  longitude: number
  rawData: {
    climate: ClimateStats | null
    housing: HousingStats | null
    transportation: TransportStats | null
    amenities: AmenityStats | null
    geography: GeographyStats | null
  }
  sources: Record<string, SourceMetadata | null>
  dataQuality: Record<string, DataQuality>
  normalizedScores: Record<DimensionKey, number | null>
  score: number
  confidence: number
  scoreBreakdown: Record<DimensionKey, ScoreBreakdownItem>
  highlights: string[]
  tradeoffs: string[]
}

export interface HardConstraints {
  regions?: Region[]
  cities?: string[]
  districts?: string[]
  excludedCities?: string[]
  excludedDistricts?: string[]
  minMonthlyRent?: number
  maxMonthlyRent?: number
  maxCommuteMinutes?: number
}

export interface PreferenceState {
  version: number
  hardConstraints: HardConstraints
  softPreferences: {
    housing: { weight: number; preferLowerRent: number }
    climate: {
      weight: number
      temperature: { preferredMin?: number; preferredMax?: number; weight: number }
      rainfall: { preference: PreferenceLevel; weight: number }
      humidity: { preference: PreferenceLevel; weight: number }
    }
    transportation: {
      weight: number
      railwayAccess: number
      highSpeedRailAccess: number
      mrtAccess: number
      busAccess: number
    }
    amenities: {
      weight: number
      convenienceStore: number
      supermarket: number
      hospital: number
      clinic: number
      restaurant: number
      school: number
      park: number
    }
    geography: {
      weight: number
      urbanDensity: number
      elevation: number
      coastalPreference: number
    }
  }
}

/** Every field optional; the backend deep-merges and bumps `version`. */
export type PreferencePatch = {
  hardConstraints?: Partial<HardConstraints>
  softPreferences?: {
    [K in DimensionKey]?: Partial<Record<string, unknown>> & { weight?: number }
  }
}

export interface ConversationMessage {
  id: string
  turnId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface RankingSnapshot {
  id: string
  preferenceVersion: number
  candidates: Candidate[]
  createdAt: string
}

export interface SearchSession {
  id: string
  userId: string | null
  preferences: PreferenceState
  conversation: ConversationMessage[]
  candidates: Candidate[]
  rankingHistory: RankingSnapshot[]
  createdAt: string
  updatedAt: string
}

interface EventBase {
  turnId: string
  timestamp: string
}

export type AgentEvent =
  | (EventBase & { type: 'message.started' })
  | (EventBase & { type: 'message.delta'; delta: string })
  | (EventBase & {
      type: 'message.completed'
      message: string
      model?: string
      usage?: { input: number; output: number; totalTokens: number; costUsd: number }
    })
  | (EventBase & { type: 'tool.started'; toolCallId: string; toolName: string; arguments: unknown })
  | (EventBase & { type: 'tool.completed'; toolCallId: string; toolName: string; isError: boolean; durationMs: number })
  | (EventBase & { type: 'preferences.updated'; preferences: PreferenceState })
  | (EventBase & { type: 'candidates.updated'; candidates: Candidate[] })
  | (EventBase & { type: 'ranking.updated'; candidates: Candidate[] })
  | (EventBase & { type: 'error'; code: string; message: string; recoverable: boolean })

export interface BackendHealth {
  status: 'ok'
  /** e.g. "deterministic-fallback" or the Pi runtime name. */
  runtime: string
}
