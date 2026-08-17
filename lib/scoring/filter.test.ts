import { describe, expect, it } from 'vitest'
import { applyHardFilter } from './filter'
import { makeListing } from '@/lib/test-utils/factory'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'

const profile = (o: Partial<SearchProfile> = {}): SearchProfile => ({ ...DEFAULT_PROFILE, ...o })

describe('applyHardFilter', () => {
  it('依 mode 篩選', () => {
    const pool = [makeListing({ id: 'S', mode: 'sale' }), makeListing({ id: 'R', mode: 'rent' })]
    expect(applyHardFilter(pool, profile({ mode: 'rent' })).map((l) => l.id)).toEqual(['R'])
  })

  it('依 cities 與 districts 篩選', () => {
    const pool = [
      makeListing({ id: 'A', city: '臺北市', district: '大安區' }),
      makeListing({ id: 'B', city: '臺北市', district: '北投區' }),
      makeListing({ id: 'C', city: '新北市', district: '板橋區' }),
    ]
    expect(applyHardFilter(pool, profile({ hard: { cities: ['臺北市'] } })).map((l) => l.id)).toEqual(['A', 'B'])
    expect(applyHardFilter(pool, profile({ hard: { districts: ['板橋區'] } })).map((l) => l.id)).toEqual(['C'])
  })

  it('依預算上下限篩選', () => {
    const pool = [
      makeListing({ id: 'A', price: 1000 }),
      makeListing({ id: 'B', price: 2000 }),
      makeListing({ id: 'C', price: 3000 }),
    ]
    expect(applyHardFilter(pool, profile({ hard: { budgetMax: 2000 } })).map((l) => l.id)).toEqual(['A', 'B'])
    expect(applyHardFilter(pool, profile({ hard: { budgetMin: 2000 } })).map((l) => l.id)).toEqual(['B', 'C'])
  })

  it('依坪數、房數、屋齡、型態篩選', () => {
    const pool = [
      makeListing({ id: 'A', area: 15, rooms: 1, age: 5, buildingType: '套房' }),
      makeListing({ id: 'B', area: 35, rooms: 3, age: 40, buildingType: '公寓' }),
      makeListing({ id: 'C', area: 30, rooms: 3, age: 8, buildingType: '電梯大樓' }),
    ]
    expect(applyHardFilter(pool, profile({ hard: { minArea: 25 } })).map((l) => l.id)).toEqual(['B', 'C'])
    expect(applyHardFilter(pool, profile({ hard: { minRooms: 3 } })).map((l) => l.id)).toEqual(['B', 'C'])
    expect(applyHardFilter(pool, profile({ hard: { maxAge: 20 } })).map((l) => l.id)).toEqual(['A', 'C'])
    expect(applyHardFilter(pool, profile({ hard: { buildingTypes: ['電梯大樓'] } })).map((l) => l.id)).toEqual(['C'])
  })

  it('依電梯、車位、捷運距離篩選', () => {
    const pool = [
      makeListing({ id: 'A', hasElevator: false, hasParking: false, features: { distToMetro: 300 } }),
      makeListing({ id: 'B', hasElevator: true, hasParking: true, features: { distToMetro: 1500 } }),
    ]
    expect(applyHardFilter(pool, profile({ hard: { needElevator: true } })).map((l) => l.id)).toEqual(['B'])
    expect(applyHardFilter(pool, profile({ hard: { needParking: true } })).map((l) => l.id)).toEqual(['B'])
    expect(applyHardFilter(pool, profile({ hard: { maxDistToMetro: 800 } })).map((l) => l.id)).toEqual(['A'])
  })

  it('distToMetro 為 null 時，maxDistToMetro 不排除該筆（缺值不等於不合格）', () => {
    const pool = [makeListing({ id: 'A', features: { distToMetro: null } })]
    expect(applyHardFilter(pool, profile({ hard: { maxDistToMetro: 800 } })).map((l) => l.id)).toEqual(['A'])
  })

  it('無條件時回傳同 mode 的全部', () => {
    const pool = [makeListing({ id: 'A' }), makeListing({ id: 'B' })]
    expect(applyHardFilter(pool, profile())).toHaveLength(2)
  })
})
