import { describe, expect, it } from 'vitest'
import { rankWithRelaxation } from './relax'
import { makeListing } from '@/lib/test-utils/factory'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'

const profile = (o: Partial<SearchProfile> = {}): SearchProfile => ({ ...DEFAULT_PROFILE, ...o })

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

  it('一有結果就停止放寬，不會過度放寬', () => {
    const pool = [makeListing({ id: 'A', features: { distToMetro: 900 } })]
    const out = rankWithRelaxation(profile({ hard: { maxDistToMetro: 600, maxAge: 20 } }), pool)
    expect(out.relaxations).toHaveLength(1)
  })
})
