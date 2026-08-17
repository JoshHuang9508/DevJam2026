import { describe, expect, it } from 'vitest'
import { FENGSHUI_RULES, FENGSHUI_RULE_BY_KEY } from './rules'
import {
  FENGSHUI_FEATURE_KEYS,
  FENGSHUI_ISSUE_KEYS,
  type FengshuiEvidence,
} from '@/lib/types/fengshui'

/** 全部未檢測的空白證據，測試只覆寫關心的欄位 */
const blank = (): FengshuiEvidence => ({
  fsEntryWindowAligned: null,
  fsEntryScreen: null,
  fsStoveVisibleFromDoor: null,
  fsToiletFacingDoor: null,
  fsBeamOverBed: null,
  fsLivingRoomDepthM: null,
  fsDaylightBlocked: null,
  fsRoadRush: null,
})

const ev = (o: Partial<FengshuiEvidence> = {}): FengshuiEvidence => ({ ...blank(), ...o })

describe('FENGSHUI_RULES 結構', () => {
  it('六條規則、與 FENGSHUI_ISSUE_KEYS 同序', () => {
    expect(FENGSHUI_RULES.map((r) => r.key)).toEqual([...FENGSHUI_ISSUE_KEYS])
  })

  it('severity 總和為 1', () => {
    const sum = FENGSHUI_RULES.reduce((a, r) => a + r.severity, 0)
    expect(sum).toBeCloseTo(1, 10)
  })

  it('每條都有 name / detection / taboo / remedy 文字，inputs 只用合法欄位', () => {
    for (const r of FENGSHUI_RULES) {
      expect(r.name.length).toBeGreaterThan(0)
      expect(r.detection.length).toBeGreaterThan(0)
      expect(r.taboo.length).toBeGreaterThan(0)
      expect(r.remedy.length).toBeGreaterThan(0)
      expect(r.inputs.length).toBeGreaterThan(0)
      for (const k of r.inputs) expect(FENGSHUI_FEATURE_KEYS).toContain(k)
    }
  })

  it('FENGSHUI_RULE_BY_KEY 每個 key 都指回同一條規則', () => {
    for (const r of FENGSHUI_RULES) expect(FENGSHUI_RULE_BY_KEY[r.key]).toBe(r)
  })

  it('全部欄位未檢測時，六條 risk 都是 null', () => {
    for (const r of FENGSHUI_RULES) expect(r.risk(blank())).toBeNull()
  })
})

describe('穿堂煞 throughDraft', () => {
  const risk = FENGSHUI_RULE_BY_KEY.throughDraft.risk

  it('命中：大門對窗且無屏風', () => {
    expect(risk(ev({ fsEntryWindowAligned: 1, fsEntryScreen: 0 }))).toBe(1)
  })

  it('無虞：本來就沒對齊', () => {
    expect(risk(ev({ fsEntryWindowAligned: 0, fsEntryScreen: 0 }))).toBe(0)
  })

  it('屏風化解：aligned=1、screen=1 → risk 0', () => {
    expect(risk(ev({ fsEntryWindowAligned: 1, fsEntryScreen: 1 }))).toBe(0)
  })

  it('小數輸入：aligned=0.5、screen=0 → 0.5', () => {
    expect(risk(ev({ fsEntryWindowAligned: 0.5, fsEntryScreen: 0 }))).toBeCloseTo(0.5, 10)
  })

  it('小數屏風等比折抵：aligned=1、screen=0.25 → 0.75', () => {
    expect(risk(ev({ fsEntryWindowAligned: 1, fsEntryScreen: 0.25 }))).toBeCloseTo(0.75, 10)
  })

  it('未檢測：只有其中一個欄位有值也回 null', () => {
    expect(risk(ev({ fsEntryWindowAligned: 1 }))).toBeNull()
    expect(risk(ev({ fsEntryScreen: 1 }))).toBeNull()
  })
})

describe('單旗標規則 stoveInSight / toiletFacingDoor / beamPressure / roadRush', () => {
  const cases = [
    ['stoveInSight', 'fsStoveVisibleFromDoor'],
    ['toiletFacingDoor', 'fsToiletFacingDoor'],
    ['beamPressure', 'fsBeamOverBed'],
    ['roadRush', 'fsRoadRush'],
  ] as const

  for (const [key, field] of cases) {
    it(`${key}：命中 / 無虞 / 未檢測`, () => {
      const risk = FENGSHUI_RULE_BY_KEY[key].risk
      expect(risk(ev({ [field]: 1 }))).toBe(1)
      expect(risk(ev({ [field]: 0 }))).toBe(0)
      expect(risk(blank())).toBeNull()
    })

    it(`${key}：小數輸入原樣傳遞且單調`, () => {
      const risk = FENGSHUI_RULE_BY_KEY[key].risk
      expect(risk(ev({ [field]: 0.3 }))).toBeCloseTo(0.3, 10)
      expect(risk(ev({ [field]: 0.7 }))).toBeCloseTo(0.7, 10)
    })
  }
})

describe('明堂狹窄 narrowHall', () => {
  const risk = FENGSHUI_RULE_BY_KEY.narrowHall.risk
  const hall = (depth: number, blocked = 0) =>
    risk(ev({ fsLivingRoomDepthM: depth, fsDaylightBlocked: blocked }))

  it('縱深斜坡：3.6 → 0、3.0 → 0.5、2.4 → 1', () => {
    expect(hall(3.6)).toBeCloseTo(0, 10)
    expect(hall(3.0)).toBeCloseTo(0.5, 10)
    expect(hall(2.4)).toBeCloseTo(1, 10)
  })

  it('斜坡兩端 clamp：更深不會變負、更窄不會超過 1', () => {
    expect(hall(6)).toBe(0)
    expect(hall(1)).toBe(1)
  })

  it('採光受阻可獨立命中，取兩者較嚴重者', () => {
    expect(hall(5, 1)).toBe(1)
    expect(hall(3.0, 0.8)).toBeCloseTo(0.8, 10)
    expect(hall(2.4, 0.2)).toBeCloseTo(1, 10)
  })

  it('未檢測：缺任一欄位回 null', () => {
    expect(risk(ev({ fsLivingRoomDepthM: 3 }))).toBeNull()
    expect(risk(ev({ fsDaylightBlocked: 1 }))).toBeNull()
  })
})

/** 中位數補值會餵進 0..1 的小數，逐條掃過確認不會跑出界或變成 NaN */
describe('所有 risk 對小數輸入都落在 0..1', () => {
  const steps = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]

  it('任一輸入組合都不越界', () => {
    for (const rule of FENGSHUI_RULES) {
      for (const a of steps) {
        for (const b of steps) {
          const e = ev()
          rule.inputs.forEach((k, i) => {
            const s = i === 0 ? a : b
            // 縱深是公尺不是旗標，映射到斜坡區間才有意義
            e[k] = k === 'fsLivingRoomDepthM' ? 3.6 - s * 1.2 : s
          })
          const r = rule.risk(e)
          expect(r).not.toBeNull()
          expect(Number.isNaN(r as number)).toBe(false)
          expect(r as number).toBeGreaterThanOrEqual(0)
          expect(r as number).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('風險方向單調：加重致因不會讓 risk 下降', () => {
    for (const rule of FENGSHUI_RULES) {
      // 屏風是化解項，不是致因，固定為 0 才能觀察「對齊程度」的單調性
      const base: Partial<FengshuiEvidence> = { fsEntryScreen: 0 }
      const worsening = rule.inputs.filter((k) => k !== 'fsEntryScreen')
      for (const field of worsening) {
        let prev = -1
        for (const s of steps) {
          const e = ev({ ...base })
          for (const k of rule.inputs) e[k] = k === 'fsLivingRoomDepthM' ? 3.6 : 0
          e[field] = field === 'fsLivingRoomDepthM' ? 3.6 - s * 1.2 : s
          if (rule.key === 'throughDraft') e.fsEntryScreen = 0
          const r = rule.risk(e) as number
          expect(r).toBeGreaterThanOrEqual(prev - 1e-12)
          prev = r
        }
      }
    }
  })
})
