import { describe, expect, it } from 'vitest'
import { rankWithRelaxation } from './relax'
import { makeListing } from '@/lib/test-utils/factory'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'
import type { FengshuiEvidence } from '@/lib/types/fengshui'

const profile = (o: Partial<SearchProfile> = {}): SearchProfile => ({ ...DEFAULT_PROFILE, ...o })

// 風水證據在本檔內自備：factory 屬於資料層 agent，不從這裡改它
const FS_CLEAR: FengshuiEvidence = {
  fsEntryWindowAligned: 0,
  fsEntryScreen: 0,
  fsStoveVisibleFromDoor: 0,
  fsToiletFacingDoor: 0,
  fsBeamOverBed: 0,
  fsLivingRoomDepthM: 5,
  fsDaylightBlocked: 0,
  fsRoadRush: 0,
}

describe('rankWithRelaxation', () => {
  it('有結果時不放寬任何條件', () => {
    const pool = [makeListing({ id: 'A', price: 900 })]
    const out = rankWithRelaxation(profile({ hard: { budgetMax: 1000 } }), pool)
    expect(out.results.map((r) => r.id)).toEqual(['A'])
    expect(out.relaxations).toEqual([])
  })

  it('捷運距離過嚴時先放寬捷運距離', () => {
    const pool = [makeListing({ id: 'A', features: { distToMetro: 900 } })]
    const out = rankWithRelaxation(profile({ hard: { maxDistToMetro: 600 } }), pool)
    expect(out.results).toHaveLength(1)
    expect(out.relaxations.join()).toContain('捷運')
  })

  it('屋齡過嚴時放寬屋齡', () => {
    const pool = [makeListing({ id: 'A', age: 25 })]
    const out = rankWithRelaxation(profile({ hard: { maxAge: 20 } }), pool)
    expect(out.results).toHaveLength(1)
    expect(out.relaxations.join()).toContain('屋齡')
  })

  it('預算過嚴時放寬預算，且說明含新的數字', () => {
    const pool = [makeListing({ id: 'A', price: 1100 })]
    const out = rankWithRelaxation(profile({ hard: { budgetMax: 1000 } }), pool)
    expect(out.results).toHaveLength(1)
    expect(out.relaxations.join()).toContain('1150')
  })

  it('行政區過嚴時擴大到整個城市', () => {
    const pool = [makeListing({ id: 'A', city: '臺北市', district: '北投區' })]
    const out = rankWithRelaxation(profile({ hard: { cities: ['臺北市'], districts: ['大安區'] } }), pool)
    expect(out.results).toHaveLength(1)
    expect(out.relaxations.join()).toContain('行政區')
  })

  it('全部放寬後仍無結果時，回空陣列並說明已無符合物件', () => {
    const pool = [makeListing({ id: 'A', mode: 'rent' })]
    const out = rankWithRelaxation(profile({ mode: 'sale' }), pool)
    expect(out.results).toEqual([])
    expect(out.relaxations.length).toBeGreaterThan(0)
  })

  it('風水條件過嚴時放寬風水，訊息列出中文項目名', () => {
    const pool = [makeListing({ id: 'A', features: { ...FS_CLEAR, fsEntryWindowAligned: 1 } })]
    const out = rankWithRelaxation(profile({ hard: { avoidFengshui: ['throughDraft'] } }), pool)
    expect(out.results.map((r) => r.id)).toEqual(['A'])
    expect(out.relaxations).toEqual(['暫時不排除有穿堂煞的物件'])
  })

  it('多個風水項目時中文名以頓號串接', () => {
    const pool = [makeListing({ id: 'A', features: { ...FS_CLEAR, fsEntryWindowAligned: 1, fsToiletFacingDoor: 1 } })]
    const out = rankWithRelaxation(
      profile({ hard: { avoidFengshui: ['throughDraft', 'toiletFacingDoor'] } }), pool)
    expect(out.relaxations).toEqual(['暫時不排除有穿堂煞、開門見廁的物件'])
  })

  it('風水比行政區先讓步', () => {
    // 兩個條件都不符：先拿掉風水仍是 0 筆，再擴大行政區才有結果，藉此驗證順序
    const pool = [makeListing({
      id: 'A', city: '臺北市', district: '北投區',
      features: { ...FS_CLEAR, fsRoadRush: 1 },
    })]
    const out = rankWithRelaxation(
      profile({ hard: { cities: ['臺北市'], districts: ['大安區'], avoidFengshui: ['roadRush'] } }), pool)
    expect(out.results.map((r) => r.id)).toEqual(['A'])
    expect(out.relaxations).toHaveLength(2)
    expect(out.relaxations[0]).toContain('路衝／壁刀')
    expect(out.relaxations[1]).toContain('行政區')
  })

  it('放寬後的物件仍留在結果裡，只是不再被排除', () => {
    const pool = [
      makeListing({ id: 'A', district: '大安區', features: { ...FS_CLEAR, fsBeamOverBed: 1 } }),
      makeListing({ id: 'B', district: '大安區', features: { ...FS_CLEAR, fsBeamOverBed: 1 } }),
    ]
    const out = rankWithRelaxation(profile({ hard: { avoidFengshui: ['beamPressure'] } }), pool)
    expect(out.results.map((r) => r.id).sort()).toEqual(['A', 'B'])
  })

  it('一有結果就停止放寬，不會過度放寬', () => {
    const pool = [makeListing({ id: 'A', features: { distToMetro: 900 } })]
    const out = rankWithRelaxation(profile({ hard: { maxDistToMetro: 600, maxAge: 20 } }), pool)
    expect(out.relaxations).toHaveLength(1)
  })
})
