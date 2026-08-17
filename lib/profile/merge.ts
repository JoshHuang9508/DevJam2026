import {
  WEIGHT_KEYS,
  type HardConstraints,
  type Mode,
  type SearchProfile,
  type SoftPrefs,
  type WeightKey,
} from '@/lib/types/profile'

/** hard 欄位傳 null 代表「移除這個條件」 */
export type HardDelta = { [K in keyof HardConstraints]?: HardConstraints[K] | null }

export interface ProfileDelta {
  mode?: Mode
  weightsDelta?: Partial<Record<WeightKey, number>>
  hard?: HardDelta
  soft?: SoftPrefs
  note?: string
}

const MAX_NOTES = 10
/** 切換買/租時必須清空的欄位 — 量級完全不同，沿用會濾成 0 筆 */
const MODE_SENSITIVE_HARD_KEYS = ['budgetMin', 'budgetMax'] as const

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

export function mergeProfile(current: SearchProfile, delta: ProfileDelta): SearchProfile {
  const mode = delta.mode ?? current.mode
  const modeChanged = mode !== current.mode

  const weights = { ...current.weights }
  for (const key of WEIGHT_KEYS) {
    const d = delta.weightsDelta?.[key]
    if (typeof d === 'number' && Number.isFinite(d)) {
      weights[key] = clamp(weights[key] + d, 0, 100)
    }
  }

  const hard: HardConstraints = { ...current.hard }
  if (modeChanged) {
    for (const key of MODE_SENSITIVE_HARD_KEYS) delete hard[key]
  }
  for (const [key, value] of Object.entries(delta.hard ?? {})) {
    const k = key as keyof HardConstraints
    if (value === null || value === undefined) {
      delete hard[k]
    } else {
      // 值已由 Zod schema 驗證過型別，此處只做合併
      Object.assign(hard, { [k]: value })
    }
  }

  const soft: SoftPrefs = { ...current.soft, ...delta.soft }

  const notes = delta.note
    ? [...current.notes, delta.note].slice(-MAX_NOTES)
    : [...current.notes]

  return { mode, weights, hard, soft, notes }
}
