import { describe, expect, it } from 'vitest'
import { toPreferencePatch, toSearchProfile, weightDiff, DISTRICT_FANOUT } from './profile-bridge'
import type { Candidate, PreferenceState } from './types'
import { normalizeWeights } from '@/lib/scoring'
import { DEFAULT_PROFILE, WEIGHT_KEYS, type SearchProfile } from '@/lib/types/profile'

const prefs = (o: {
  housing?: number
  climate?: number
  transportation?: number
  amenities?: number
  preferredMax?: number
  rainfall?: 'low' | 'medium' | 'high'
  maxMonthlyRent?: number
  cities?: string[]
} = {}): PreferenceState => ({
  version: 1,
  hardConstraints: {
    ...(o.cities ? { cities: o.cities } : {}),
    ...(o.maxMonthlyRent !== undefined ? { maxMonthlyRent: o.maxMonthlyRent } : {}),
  },
  softPreferences: {
    housing: { weight: o.housing ?? 0.5, preferLowerRent: 0.5 },
    climate: {
      weight: o.climate ?? 0.5,
      temperature: { preferredMax: o.preferredMax, weight: 0.5 },
      rainfall: { preference: o.rainfall ?? 'medium', weight: 0.5 },
      humidity: { preference: 'medium', weight: 0.5 },
    },
    transportation: {
      weight: o.transportation ?? 0.5,
      railwayAccess: 0.5, highSpeedRailAccess: 0.5, mrtAccess: 0.5, busAccess: 0.5,
    },
    amenities: {
      weight: o.amenities ?? 0.5,
      convenienceStore: 0.5, supermarket: 0.5, hospital: 0.5,
      clinic: 0.5, restaurant: 0.5, school: 0.5, park: 0.5,
    },
    geography: { weight: 0.5, urbanDensity: 0.5, elevation: 0.5, coastalPreference: 0.5 },
  },
})

const candidate = (district: string): Candidate =>
  ({ id: district, city: '臺北市', district, score: 0.8 } as unknown as Candidate)

describe('toSearchProfile 的權重完整性', () => {
  it('回傳的 weights 涵蓋所有 WEIGHT_KEYS 且都是有限數', () => {
    const out = toSearchProfile(prefs(), [], DEFAULT_PROFILE)
    for (const key of WEIGHT_KEYS) {
      expect(Number.isFinite(out.weights[key]), `weights.${key} 不是有限數`).toBe(true)
    }
    expect(Object.keys(out.weights).sort()).toEqual([...WEIGHT_KEYS].sort())
  })

  it('後端沒有的維度沿用 base：fengshui 原封不動帶回來', () => {
    const base: SearchProfile = { ...DEFAULT_PROFILE, weights: { ...DEFAULT_PROFILE.weights, fengshui: 70 } }
    const out = toSearchProfile(prefs(), [], base)
    expect(out.weights.fengshui).toBe(70)
    expect(out.weights.space).toBe(base.weights.space)
    expect(out.weights.quality).toBe(base.weights.quality)
  })

  it('base 的 fengshui 為預設 0 時也回 0，不會變成 undefined', () => {
    const out = toSearchProfile(prefs(), [], DEFAULT_PROFILE)
    expect(out.weights.fengshui).toBe(0)
  })

  it('橋接後的權重丟進 normalizeWeights 不會產生 NaN', () => {
    // 漏掉任何一個維度會讓該欄位變 undefined，總和連帶失真、排序全毀，這條專門釘住它
    const normalized = normalizeWeights(toSearchProfile(prefs(), [], DEFAULT_PROFILE).weights)
    for (const key of WEIGHT_KEYS) {
      expect(Number.isNaN(normalized[key]), `normalized.${key} 是 NaN`).toBe(false)
    }
    const sum = WEIGHT_KEYS.reduce((acc, k) => acc + normalized[k], 0)
    expect(sum).toBeCloseTo(1, 10)
  })

  it('後端有對應的維度照樣被覆寫', () => {
    const out = toSearchProfile(prefs({ climate: 0.9, transportation: 0.3, amenities: 0.1 }), [], DEFAULT_PROFILE)
    expect(out.weights.weather).toBe(90)
    expect(out.weights.location).toBe(30)
    expect(out.weights.amenities).toBe(10)
  })

  it('housing 一軸拆回 price/value 時保留使用者原本的落差', () => {
    const base: SearchProfile = {
      ...DEFAULT_PROFILE,
      weights: { ...DEFAULT_PROFILE.weights, price: 70, value: 30 },
    }
    const out = toSearchProfile(prefs({ housing: 0.7 }), [], base)
    expect(out.weights.price - out.weights.value).toBe(40)
  })

  it('風水硬條件不在後端模型裡，必須原樣保留', () => {
    const base: SearchProfile = {
      ...DEFAULT_PROFILE,
      hard: { avoidFengshui: ['throughDraft'] },
    }
    const out = toSearchProfile(prefs(), [], base)
    expect(out.hard.avoidFengshui).toEqual(['throughDraft'])
  })

  it('選區最多帶 DISTRICT_FANOUT 個且去重', () => {
    const picks = ['大安區', '大安區', '中山區', '信義區', '松山區', '內湖區', '南港區', '士林區']
    const out = toSearchProfile(prefs(), picks.map(candidate), DEFAULT_PROFILE)
    expect(out.hard.districts).toEqual([...new Set(picks.slice(0, DISTRICT_FANOUT))])
  })
})

describe('toPreferencePatch', () => {
  it('只送後端表達得出來的四軸，不外洩 fengshui', () => {
    const patch = toPreferencePatch({
      ...DEFAULT_PROFILE,
      weights: { ...DEFAULT_PROFILE.weights, fengshui: 80 },
    })
    expect(Object.keys(patch.softPreferences ?? {}).sort())
      .toEqual(['amenities', 'climate', 'housing', 'transportation'])
    expect(JSON.stringify(patch)).not.toContain('fengshui')
  })

  it('風水硬條件不送到後端，它是物件層級的判定', () => {
    const patch = toPreferencePatch({
      ...DEFAULT_PROFILE,
      hard: { cities: ['臺北市'], avoidFengshui: ['roadRush'] },
    })
    expect(patch.hardConstraints?.cities).toEqual(['臺北市'])
    expect(JSON.stringify(patch)).not.toContain('roadRush')
  })
})

describe('weightDiff', () => {
  it('抓得到 fengshui 的變動', () => {
    const before = DEFAULT_PROFILE
    const after: SearchProfile = { ...DEFAULT_PROFILE, weights: { ...DEFAULT_PROFILE.weights, fengshui: 40 } }
    expect(weightDiff(before, after).fengshui).toEqual({ from: 0, to: 40 })
  })

  it('沒有變動時不列出任何維度（含新加的 fengshui）', () => {
    expect(weightDiff(DEFAULT_PROFILE, structuredClone(DEFAULT_PROFILE))).toEqual({})
  })

  it('橋接一趟後若後端沒動到的維度，不應出現在 diff 裡', () => {
    const base: SearchProfile = { ...DEFAULT_PROFILE, weights: { ...DEFAULT_PROFILE.weights, fengshui: 55 } }
    const after = toSearchProfile(prefs({ climate: 0.5, transportation: 0.5, amenities: 0.5, housing: 0.5 }), [], base)
    expect(weightDiff(base, after)).not.toHaveProperty('fengshui')
  })
})
