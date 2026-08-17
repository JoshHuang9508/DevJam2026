import type { ListingWithFeatures, RankResult } from '@/lib/types/listing'
import type { SearchProfile } from '@/lib/types/profile'
import { score } from './index'

interface RelaxStep {
  /** 此步驟是否適用於目前的 profile */
  applies: (p: SearchProfile) => boolean
  /** 回傳放寬後的 profile 與給使用者的說明 */
  apply: (p: SearchProfile) => { profile: SearchProfile; message: string }
}

const RELAX_STEPS: RelaxStep[] = [
  {
    applies: (p) => p.hard.maxDistToMetro !== undefined,
    apply: (p) => {
      const next = Math.round(p.hard.maxDistToMetro! * 1.5)
      return {
        profile: { ...p, hard: { ...p.hard, maxDistToMetro: next } },
        message: `把離捷運的距離放寬到 ${next} 公尺`,
      }
    },
  },
  {
    applies: (p) => p.hard.maxAge !== undefined,
    apply: (p) => {
      const next = p.hard.maxAge! + 10
      return {
        profile: { ...p, hard: { ...p.hard, maxAge: next } },
        message: `把屋齡上限放寬到 ${next} 年`,
      }
    },
  },
  {
    applies: (p) => p.hard.minArea !== undefined,
    apply: (p) => {
      const next = Math.round(p.hard.minArea! * 0.8 * 10) / 10
      return {
        profile: { ...p, hard: { ...p.hard, minArea: next } },
        message: `把最小坪數放寬到 ${next} 坪`,
      }
    },
  },
  {
    applies: (p) => p.hard.budgetMax !== undefined,
    apply: (p) => {
      const next = Math.round(p.hard.budgetMax! * 1.15)
      return {
        profile: { ...p, hard: { ...p.hard, budgetMax: next } },
        message: `把預算上限放寬到 ${next}`,
      }
    },
  },
  {
    applies: (p) => (p.hard.districts?.length ?? 0) > 0,
    apply: (p) => {
      const { districts: _dropped, ...rest } = p.hard
      return {
        profile: { ...p, hard: rest },
        message: '把範圍從指定行政區擴大到整個城市',
      }
    },
  },
  {
    applies: (p) => Object.keys(p.hard).some((k) => k !== 'cities'),
    apply: (p) => ({
      profile: { ...p, hard: p.hard.cities ? { cities: p.hard.cities } : {} },
      message: '暫時拿掉其餘篩選條件，只保留地區',
    }),
  },
]

/**
 * 依序放寬條件直到有結果為止，一有結果就停。
 * relaxations 必須由 agent 在回覆中明講 — 悄悄放寬會讓使用者誤以為結果符合原條件。
 */
export function rankWithRelaxation(
  profile: SearchProfile,
  pool: ListingWithFeatures[],
): RankResult {
  const direct = score(profile, pool)
  if (direct.length > 0) return { results: direct, relaxations: [] }

  let current = profile
  const relaxations: string[] = []

  for (const step of RELAX_STEPS) {
    if (!step.applies(current)) continue
    const { profile: relaxed, message } = step.apply(current)
    current = relaxed
    relaxations.push(message)
    const results = score(current, pool)
    if (results.length > 0) return { results, relaxations }
  }

  relaxations.push('放寬所有條件後仍找不到符合的物件')
  return { results: [], relaxations }
}
