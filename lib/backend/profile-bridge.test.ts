import { describe, expect, it } from 'vitest'
import { toPreferencePatch, toSearchProfile, weightDiff, DISTRICT_FANOUT } from './profile-bridge'
import type { Candidate, PreferenceState } from './types'
import { normalizeWeights } from '@/lib/scoring'
import { DEFAULT_PROFILE, WEIGHT_KEYS, type SearchProfile } from '@/lib/types/profile'
import type { FengshuiIssueKey } from '@/lib/types/fengshui'

const prefs = (o: {
  housing?: number
  climate?: number
  transportation?: number
  amenities?: number
  preferredMax?: number
  rainfall?: 'low' | 'medium' | 'high'
  maxMonthlyRent?: number
  cities?: string[]
  fengshuiWeight?: number
  avoidFengshui?: FengshuiIssueKey[]
} = {}): PreferenceState => ({
  version: 1,
  hardConstraints: {
    ...(o.cities ? { cities: o.cities } : {}),
    ...(o.maxMonthlyRent !== undefined ? { maxMonthlyRent: o.maxMonthlyRent } : {}),
  },
  listingPreferences: {
    fengshuiWeight: o.fengshuiWeight ?? 0,
    avoidFengshui: o.avoidFengshui ?? [],
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

  it('space/quality 沒有後端對應，一律沿用 base', () => {
    const base: SearchProfile = { ...DEFAULT_PROFILE, weights: { ...DEFAULT_PROFILE.weights, space: 70, quality: 20 } }
    const out = toSearchProfile(prefs(), [], base)
    expect(out.weights.space).toBe(70)
    expect(out.weights.quality).toBe(20)
  })

  it('後端回同一個 fengshui 值時沿用 base，不因往返換算漂移', () => {
    const base: SearchProfile = { ...DEFAULT_PROFILE, weights: { ...DEFAULT_PROFILE.weights, fengshui: 70 } }
    const out = toSearchProfile(prefs({ fengshuiWeight: 0.7 }), [], base)
    expect(out.weights.fengshui).toBe(70)
  })

  it('agent 從對話調高風水權重時，滑桿要跟著動', () => {
    // 這是把風水接線移到後端 agent 的重點：使用者說「我很在意風水」，
    // agent 寫進 listingPreferences.fengshuiWeight，前端這一維必須真的被覆寫。
    const out = toSearchProfile(prefs({ fengshuiWeight: 0.85 }), [], DEFAULT_PROFILE)
    expect(out.weights.fengshui).toBe(85)
  })

  it('base 的 fengshui 為預設 0 時也回 0，不會變成 undefined', () => {
    const out = toSearchProfile(prefs(), [], DEFAULT_PROFILE)
    expect(out.weights.fengshui).toBe(0)
  })

  it('後端沒有 listingPreferences（舊版後端）時沿用 base，不會炸掉', () => {
    const stale = prefs()
    delete stale.listingPreferences
    const base: SearchProfile = {
      ...DEFAULT_PROFILE,
      weights: { ...DEFAULT_PROFILE.weights, fengshui: 60 },
      hard: { avoidFengshui: ['narrowHall'] },
    }
    const out = toSearchProfile(stale, [], base)
    expect(out.weights.fengshui).toBe(60)
    expect(out.hard.avoidFengshui).toEqual(['narrowHall'])
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

  it('agent 指名的風水忌諱會變成硬條件', () => {
    const out = toSearchProfile(prefs({ avoidFengshui: ['throughDraft', 'toiletFacingDoor'] }), [], DEFAULT_PROFILE)
    expect(out.hard.avoidFengshui).toEqual(['throughDraft', 'toiletFacingDoor'])
  })

  it('後端回空陣列代表取消避開，欄位要被刪掉而不是留一個空陣列', () => {
    // 留著 `avoidFengshui: []` 會讓 lib/scoring 的 filter 以為還有條件在，
    // 讀 profile.hard 的地方也會誤判「使用者設過風水條件」。
    const base: SearchProfile = { ...DEFAULT_PROFILE, hard: { avoidFengshui: ['roadRush'] } }
    const out = toSearchProfile(prefs({ avoidFengshui: [] }), [], base)
    expect(out.hard).not.toHaveProperty('avoidFengshui')
  })

  it('選區最多帶 DISTRICT_FANOUT 個且去重', () => {
    const picks = ['大安區', '大安區', '中山區', '信義區', '松山區', '內湖區', '南港區', '士林區']
    const out = toSearchProfile(prefs(), picks.map(candidate), DEFAULT_PROFILE)
    expect(out.hard.districts).toEqual([...new Set(picks.slice(0, DISTRICT_FANOUT))])
  })
})

describe('toPreferencePatch', () => {
  it('softPreferences 只放後端排行政區用得到的四軸，風水不混進去', () => {
    const patch = toPreferencePatch({
      ...DEFAULT_PROFILE,
      weights: { ...DEFAULT_PROFILE.weights, fengshui: 80 },
    })
    // 風水不是行政區的性質，混進 softPreferences 會被誤認為第六個排序維度。
    expect(Object.keys(patch.softPreferences ?? {}).sort())
      .toEqual(['amenities', 'climate', 'housing', 'transportation'])
    expect(JSON.stringify(patch.softPreferences)).not.toContain('fengshui')
  })

  it('風水以 listingPreferences 送出，agent 才知道使用者目前的設定', () => {
    const patch = toPreferencePatch({
      ...DEFAULT_PROFILE,
      weights: { ...DEFAULT_PROFILE.weights, fengshui: 80 },
      hard: { cities: ['臺北市'], avoidFengshui: ['roadRush'] },
    })
    expect(patch.hardConstraints?.cities).toEqual(['臺北市'])
    expect(patch.listingPreferences?.fengshuiWeight).toBe(0.8)
    expect(patch.listingPreferences?.avoidFengshui).toEqual(['roadRush'])
  })

  it('沒設避開項時送空陣列 —— 那是唯一能表達「取消避開」的方式', () => {
    // 後端的 deep-merge 會跳過 undefined，省略欄位等於「不要動」，清不掉既有的值。
    const patch = toPreferencePatch(DEFAULT_PROFILE)
    expect(patch.listingPreferences?.avoidFengshui).toEqual([])
    expect(patch.listingPreferences?.fengshuiWeight).toBe(0)
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
    // 後端把我們送上去的值原樣回來（0.55），代表 agent 這一輪沒動風水 —— 面板不該閃爍。
    const after = toSearchProfile(
      prefs({ climate: 0.5, transportation: 0.5, amenities: 0.5, housing: 0.5, fengshuiWeight: 0.55 }),
      [],
      base,
    )
    expect(weightDiff(base, after)).not.toHaveProperty('fengshui')
  })

  it('agent 動了風水就要出現在 diff 裡，面板才會閃爍', () => {
    const base: SearchProfile = { ...DEFAULT_PROFILE, weights: { ...DEFAULT_PROFILE.weights, fengshui: 0 } }
    const after = toSearchProfile(prefs({ fengshuiWeight: 0.6 }), [], base)
    expect(weightDiff(base, after).fengshui).toEqual({ from: 0, to: 60 })
  })
})
