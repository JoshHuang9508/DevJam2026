import { FENGSHUI_RULE_BY_KEY } from '@/lib/fengshui/rules'
import type { ListingWithFeatures, RankResult } from '@/lib/types/listing'
import type { HardConstraints, SearchProfile } from '@/lib/types/profile'
import { score, type ScoreOptions } from './index'

/**
 * 地區條件。**放寬階梯永遠不會動這幾個 key** —— 使用者說「我只要大安區」，
 * 拿一堆信義區的物件給他不是「盡力而為」，是答非所問：地區是他用來
 * 判斷「這則回答跟我有沒有關係」的第一個欄位，放寬掉等於偷換題目。
 * 找不到就照實說找不到，由 agent 去建議換區，而不是系統靜靜換掉。
 */
const AREA_KEYS = ['regions', 'cities', 'districts', 'excludedCities', 'excludedDistricts'] as const
type AreaKey = (typeof AREA_KEYS)[number]

const pickArea = (h: HardConstraints): HardConstraints => {
  const out: HardConstraints = {}
  if (h.regions?.length) out.regions = h.regions
  if (h.cities?.length) out.cities = h.cities
  if (h.districts?.length) out.districts = h.districts
  if (h.excludedCities?.length) out.excludedCities = h.excludedCities
  if (h.excludedDistricts?.length) out.excludedDistricts = h.excludedDistricts
  return out
}

/** 使用者是否指定過地區。決定找不到時要怎麼說。 */
export const hasAreaConstraint = (h: HardConstraints): boolean =>
  AREA_KEYS.some((key) => (h[key]?.length ?? 0) > 0)

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
  // 排在擴大行政區之前：風水是文化偏好，比「住哪一區」容易讓步，
  // 而且拿掉後這些物件只是重新出現在清單裡（風水維度仍會扣它們的分），
  // 不像換區那樣直接改變使用者的生活範圍。
  {
    applies: (p) => (p.hard.avoidFengshui?.length ?? 0) > 0,
    apply: (p) => {
      const names = p.hard.avoidFengshui!.map((k) => FENGSHUI_RULE_BY_KEY[k].name).join('、')
      const { avoidFengshui: _dropped, ...rest } = p.hard
      return {
        profile: { ...p, hard: rest },
        message: `暫時不排除有${names}的物件`,
      }
    },
  },
  {
    applies: (p) => Object.keys(p.hard).some((k) => !AREA_KEYS.includes(k as AreaKey)),
    apply: (p) => ({
      profile: { ...p, hard: pickArea(p.hard) },
      message: '暫時拿掉其餘篩選條件，只保留你指定的地區',
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
  options: ScoreOptions = {},
): RankResult {
  // 放寬與否一律用**不含視角**的結果判斷。把地圖拖到海上會讓視角內 0 筆，
  // 但那不是「條件太嚴」—— 若照 0 筆就啟動階梯，使用者只是平移一下地圖，
  // 預算與坪數條件就會被靜靜放寬掉。
  const direct = score(profile, pool)
  if (direct.length > 0) return { results: score(profile, pool, options), relaxations: [] }

  let current = profile
  const relaxations: string[] = []

  for (const step of RELAX_STEPS) {
    if (!step.applies(current)) continue
    const { profile: relaxed, message } = step.apply(current)
    current = relaxed
    relaxations.push(message)
    if (score(current, pool).length > 0) return { results: score(current, pool, options), relaxations }
  }

  relaxations.push(
    hasAreaConstraint(profile.hard)
      ? '除了地區以外的條件都放寬過了，你指定的地區內仍然沒有符合的物件（地區不會自動放寬）'
      : '放寬所有條件後仍找不到符合的物件',
  )
  return { results: [], relaxations }
}
