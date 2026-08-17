import { describe, expect, it } from 'vitest'
import { FENGSHUI_HIT, FENGSHUI_UNKNOWN_RISK, auditFengshui, fengshuiSubscore, ruleRisk } from './audit'
import { FENGSHUI_RULE_BY_KEY } from './rules'
import { FENGSHUI_ISSUE_KEYS, type FengshuiEvidence } from '@/lib/types/fengshui'

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

/** 六條規則全部檢測、全部無虞 */
const allClear = (o: Partial<FengshuiEvidence> = {}): FengshuiEvidence =>
  ev({
    fsEntryWindowAligned: 0,
    fsEntryScreen: 0,
    fsStoveVisibleFromDoor: 0,
    fsToiletFacingDoor: 0,
    fsBeamOverBed: 0,
    fsLivingRoomDepthM: 4.5,
    fsDaylightBlocked: 0,
    fsRoadRush: 0,
    ...o,
  })

/** 六條規則全部檢測、全部滿分命中 */
const allHit = (): FengshuiEvidence =>
  ev({
    fsEntryWindowAligned: 1,
    fsEntryScreen: 0,
    fsStoveVisibleFromDoor: 1,
    fsToiletFacingDoor: 1,
    fsBeamOverBed: 1,
    fsLivingRoomDepthM: 2.0,
    fsDaylightBlocked: 1,
    fsRoadRush: 1,
  })

const sev = (k: (typeof FENGSHUI_ISSUE_KEYS)[number]) => FENGSHUI_RULE_BY_KEY[k].severity

describe('ruleRisk', () => {
  it('轉發到對應規則', () => {
    expect(ruleRisk('roadRush', ev({ fsRoadRush: 1 }))).toBe(1)
    expect(ruleRisk('roadRush', ev({ fsRoadRush: 0 }))).toBe(0)
  })

  it('輸入不足回 null，而不是 0', () => {
    expect(ruleRisk('roadRush', blank())).toBeNull()
    expect(ruleRisk('throughDraft', ev({ fsEntryWindowAligned: 1 }))).toBeNull()
  })
})

describe('auditFengshui 分數公式', () => {
  it('全部清白 → score 1，六條都在 clear', () => {
    const a = auditFengshui(allClear())
    expect(a.score).toBeCloseTo(1, 10)
    expect(a.issues).toEqual([])
    expect(a.clear).toEqual([...FENGSHUI_ISSUE_KEYS])
    expect(a.unknown).toEqual([])
  })

  it('全部命中 → score 0，六條都在 issues', () => {
    const a = auditFengshui(allHit())
    expect(a.score).toBeCloseTo(0, 10)
    expect(a.issues.map((i) => i.key).sort()).toEqual([...FENGSHUI_ISSUE_KEYS].sort())
    expect(a.clear).toEqual([])
    expect(a.unknown).toEqual([])
  })

  it('部分命中：score = 1 - Σ(severity*risk)/Σ(severity)', () => {
    // 只有開門見廁與路衝滿分命中，其餘四條檢測後無虞
    const a = auditFengshui(allClear({ fsToiletFacingDoor: 1, fsRoadRush: 1 }))
    const expected = 1 - (sev('toiletFacingDoor') + sev('roadRush')) / 1
    expect(a.score).toBeCloseTo(expected, 10)
    expect(a.issues.map((i) => i.key)).toEqual(['toiletFacingDoor', 'roadRush'])
    expect(a.clear).toEqual(['throughDraft', 'stoveInSight', 'beamPressure', 'narrowHall'])
  })

  it('小數 risk 也按比例扣分（未達門檻不進 issues，但仍然扣分）', () => {
    const a = auditFengshui(allClear({ fsBeamOverBed: 0.4 }))
    expect(a.score).toBeCloseTo(1 - (sev('beamPressure') * 0.4) / 1, 10)
    expect(a.issues).toEqual([])
    expect(a.clear).toContain('beamPressure')
  })
})

describe('auditFengshui 未檢測處理', () => {
  it('未檢測的規則同時退出分子與分母', () => {
    // roadRush 未檢測：分母應為其餘五條 severity 之和
    const e = allClear({ fsRoadRush: null, fsToiletFacingDoor: 1 })
    const a = auditFengshui(e)
    const denom = [...FENGSHUI_ISSUE_KEYS].filter((k) => k !== 'roadRush').reduce((s, k) => s + sev(k), 0)
    expect(denom).toBeCloseTo(1 - sev('roadRush'), 10)
    expect(a.unknown).toEqual(['roadRush'])
    expect(a.score).toBeCloseTo(1 - sev('toiletFacingDoor') / denom, 10)
  })

  it('未檢測不會被當成無虞：只檢測一條時分母就是那一條', () => {
    const a = auditFengshui(ev({ fsRoadRush: 1 }))
    expect(a.score).toBeCloseTo(0, 10)
    expect(a.issues.map((i) => i.key)).toEqual(['roadRush'])
    expect(a.clear).toEqual([])
    expect(a.unknown).toEqual(
      [...FENGSHUI_ISSUE_KEYS].filter((k) => k !== 'roadRush'),
    )
  })

  it('全部未檢測 → score 為 null，六條都在 unknown', () => {
    const a = auditFengshui(blank())
    expect(a.score).toBeNull()
    expect(a.issues).toEqual([])
    expect(a.clear).toEqual([])
    expect(a.unknown).toEqual([...FENGSHUI_ISSUE_KEYS])
  })
})

describe('auditFengshui 命中門檻與排序', () => {
  it(`risk 恰好等於 ${FENGSHUI_HIT} 算命中，略低於則算無虞`, () => {
    expect(auditFengshui(allClear({ fsBeamOverBed: FENGSHUI_HIT })).issues.map((i) => i.key))
      .toEqual(['beamPressure'])
    expect(auditFengshui(allClear({ fsBeamOverBed: FENGSHUI_HIT - 0.01 })).issues).toEqual([])
  })

  it('issues 依 severity*risk 由大到小排', () => {
    // 穿堂煞 0.25*0.6=0.15、開門見廁 0.20*1=0.20、路衝 0.15*0.8=0.12
    const a = auditFengshui(
      allClear({
        fsEntryWindowAligned: 0.6,
        fsEntryScreen: 0,
        fsToiletFacingDoor: 1,
        fsRoadRush: 0.8,
      }),
    )
    expect(a.issues.map((i) => i.key)).toEqual(['toiletFacingDoor', 'throughDraft', 'roadRush'])
    expect(a.issues.map((i) => i.risk)).toEqual([1, 0.6, 0.8])
  })

  it('嚴重度低但滿分命中，可以排在嚴重度高卻剛過門檻的前面', () => {
    // 開門見廁 0.20*0.5=0.10 < 開門見灶 0.15*1=0.15
    const a = auditFengshui(allClear({ fsToiletFacingDoor: 0.5, fsStoveVisibleFromDoor: 1 }))
    expect(a.issues.map((i) => i.key)).toEqual(['stoveInSight', 'toiletFacingDoor'])
  })

  it('issues + clear + unknown 恆為六條、不重不漏', () => {
    const a = auditFengshui(allClear({ fsRoadRush: 1, fsBeamOverBed: null }))
    const all = [...a.issues.map((i) => i.key), ...a.clear, ...a.unknown]
    expect(all).toHaveLength(FENGSHUI_ISSUE_KEYS.length)
    expect(new Set(all).size).toBe(FENGSHUI_ISSUE_KEYS.length)
  })
})

describe('fengshuiSubscore', () => {
  it('六項全數無虞為 1，全數命中為 0', () => {
    expect(fengshuiSubscore(allClear())).toBeCloseTo(1)
    expect(
      fengshuiSubscore(
        ev({
          fsEntryWindowAligned: 1,
          fsEntryScreen: 0,
          fsStoveVisibleFromDoor: 1,
          fsToiletFacingDoor: 1,
          fsBeamOverBed: 1,
          fsLivingRoomDepthM: 2.0,
          fsDaylightBlocked: 1,
          fsRoadRush: 1,
        }),
      ),
    ).toBeCloseTo(0)
  })

  it('六項全部未檢測落在中性值，不是滿分也不是零分', () => {
    expect(fengshuiSubscore(blank())).toBeCloseTo(FENGSHUI_UNKNOWN_RISK)
  })

  /**
   * 這是本維度存在的理由：中位數補值會把「沒有格局圖」變成「這一項沒問題」，
   * 於是缺資料的物件拿到滿分排到最前面。未檢測必須比「檢測後確認無虞」低分。
   */
  it('缺資料不得優於已檢測且無虞的物件', () => {
    const checkedClean = fengshuiSubscore(allClear())
    const noFloorPlan = fengshuiSubscore(ev({ fsRoadRush: 0 }))
    expect(noFloorPlan).toBeLessThan(checkedClean)
    // 也不該低於「檢測後確認全部命中」——缺資料不是罪
    const allHit = fengshuiSubscore(
      ev({
        fsEntryWindowAligned: 1,
        fsEntryScreen: 0,
        fsStoveVisibleFromDoor: 1,
        fsToiletFacingDoor: 1,
        fsBeamOverBed: 1,
        fsLivingRoomDepthM: 2.0,
        fsDaylightBlocked: 1,
        fsRoadRush: 1,
      }),
    )
    expect(noFloorPlan).toBeGreaterThan(allHit)
  })

  it('未檢測項只以自身 severity 計入中性風險', () => {
    // 路衝 severity 0.15，其餘五條檢測後無虞 → 1 - 0.15*0.5 = 0.925
    expect(fengshuiSubscore(allClear({ fsRoadRush: null }))).toBeCloseTo(0.925)
  })

  it('恆落在 0..1，且命中越多分數越低', () => {
    const one = fengshuiSubscore(allClear({ fsToiletFacingDoor: 1 }))
    const two = fengshuiSubscore(allClear({ fsToiletFacingDoor: 1, fsBeamOverBed: 1 }))
    expect(one).toBeGreaterThan(two)
    for (const v of [one, two, fengshuiSubscore(blank())]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})
