import { describe, expect, it } from 'vitest'
import { fillDataGaps } from './gaps'
import { makeListing } from '@/lib/test-utils/factory'

describe('fillDataGaps', () => {
  it('用同行政區中位數補 null，並記錄 dataGaps', () => {
    const pool = [
      makeListing({ id: 'A', features: { aqiMean: 30 } }),
      makeListing({ id: 'B', features: { aqiMean: 50 } }),
      makeListing({ id: 'C', features: { aqiMean: null } }),
    ]
    const filled = fillDataGaps(pool)
    const c = filled.find((f) => f.listing.id === 'C')!
    expect(c.features.aqiMean).toBe(40)
    expect(c.dataGaps).toContain('aqiMean')
  })

  it('無缺值時 dataGaps 為空', () => {
    const filled = fillDataGaps([makeListing({ id: 'A' })])
    expect(filled[0].dataGaps).toEqual([])
  })

  it('同區全為 null 時退回全池中位數', () => {
    const pool = [
      makeListing({ id: 'A', district: '大安區', features: { distToMetro: 400 } }),
      makeListing({ id: 'B', district: '大安區', features: { distToMetro: 800 } }),
      makeListing({ id: 'C', district: '汐止區', features: { distToMetro: null } }),
    ]
    const c = fillDataGaps(pool).find((f) => f.listing.id === 'C')!
    expect(c.features.distToMetro).toBe(600)
    expect(c.dataGaps).toContain('distToMetro')
  })

  it('全池皆為 null 時填 0 且仍標記缺值', () => {
    const pool = [makeListing({ id: 'A', features: { sunHours: null } })]
    const a = fillDataGaps(pool)[0]
    expect(a.features.sunHours).toBe(0)
    expect(a.dataGaps).toContain('sunHours')
  })

  it('不改動原始 listing 物件', () => {
    const pool = [makeListing({ id: 'A', features: { aqiMean: null } })]
    fillDataGaps(pool)
    expect(pool[0].features.aqiMean).toBeNull()
  })
})
