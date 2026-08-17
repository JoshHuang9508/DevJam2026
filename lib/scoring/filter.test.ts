import { describe, expect, it } from 'vitest'
import { applyHardFilter } from './filter'
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

  describe('avoidFengshui', () => {
    it('排除確定命中指定忌諱的物件', () => {
      const pool = [
        makeListing({ id: 'A', features: { ...FS_CLEAR, fsToiletFacingDoor: 1 } }),
        makeListing({ id: 'B', features: FS_CLEAR }),
      ]
      const out = applyHardFilter(pool, profile({ hard: { avoidFengshui: ['toiletFacingDoor'] } }))
      expect(out.map((l) => l.id)).toEqual(['B'])
    })

    it('只排除被點名的那一項，其他忌諱照樣留著', () => {
      const pool = [makeListing({ id: 'A', features: { ...FS_CLEAR, fsBeamOverBed: 1 } })]
      const out = applyHardFilter(pool, profile({ hard: { avoidFengshui: ['toiletFacingDoor'] } }))
      expect(out.map((l) => l.id)).toEqual(['A'])
    })

    it('多個項目時任一命中即排除', () => {
      const pool = [
        makeListing({ id: 'A', features: { ...FS_CLEAR, fsRoadRush: 1 } }),
        makeListing({ id: 'B', features: { ...FS_CLEAR, fsStoveVisibleFromDoor: 1 } }),
        makeListing({ id: 'C', features: FS_CLEAR }),
      ]
      const out = applyHardFilter(pool, profile({ hard: { avoidFengshui: ['roadRush', 'stoveInSight'] } }))
      expect(out.map((l) => l.id)).toEqual(['C'])
    })

    it('證據為 null 時不排除該筆（未檢測不等於命中）', () => {
      const pool = [makeListing({ id: 'A', features: { ...FS_CLEAR, fsToiletFacingDoor: null } })]
      const out = applyHardFilter(pool, profile({ hard: { avoidFengshui: ['toiletFacingDoor'] } }))
      expect(out.map((l) => l.id)).toEqual(['A'])
    })

    it('規則的任一輸入缺值就整條視為未檢測，不排除', () => {
      // 穿堂煞需要對齊與屏風兩個欄位，少了屏風就無從判斷是否已化解
      const pool = [makeListing({ id: 'A', features: { ...FS_CLEAR, fsEntryWindowAligned: 1, fsEntryScreen: null } })]
      const out = applyHardFilter(pool, profile({ hard: { avoidFengshui: ['throughDraft'] } }))
      expect(out.map((l) => l.id)).toEqual(['A'])
    })

    it('risk 低於 FENGSHUI_HIT 不排除（已用屏風化解的穿堂煞留下）', () => {
      const pool = [
        makeListing({ id: 'A', features: { ...FS_CLEAR, fsEntryWindowAligned: 1, fsEntryScreen: 1 } }),
        makeListing({ id: 'B', features: { ...FS_CLEAR, fsEntryWindowAligned: 1, fsEntryScreen: 0 } }),
      ]
      const out = applyHardFilter(pool, profile({ hard: { avoidFengshui: ['throughDraft'] } }))
      expect(out.map((l) => l.id)).toEqual(['A'])
    })

    it('空陣列等同沒指定，不排除任何物件', () => {
      const pool = [makeListing({ id: 'A', features: { ...FS_CLEAR, fsRoadRush: 1 } })]
      expect(applyHardFilter(pool, profile({ hard: { avoidFengshui: [] } }))).toHaveLength(1)
    })

    it('未指定 avoidFengshui 時，風水再差也不影響過濾（既有行為零回歸）', () => {
      const pool = [makeListing({
        id: 'A',
        features: {
          fsEntryWindowAligned: 1, fsEntryScreen: 0, fsStoveVisibleFromDoor: 1,
          fsToiletFacingDoor: 1, fsBeamOverBed: 1, fsLivingRoomDepthM: 2,
          fsDaylightBlocked: 1, fsRoadRush: 1,
        },
      })]
      expect(applyHardFilter(pool, profile())).toHaveLength(1)
    })
  })
})
