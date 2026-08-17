import { describe, expect, it } from 'vitest'
import { estimateCommuteMinutes, haversineMeters } from './geo'

const TAIPEI_STATION = { lat: 25.0478, lng: 121.5170 }
const BANQIAO_STATION = { lat: 25.0143, lng: 121.4637 }

describe('haversineMeters', () => {
  it('同一點距離為 0', () => {
    expect(haversineMeters(25, 121, 25, 121)).toBe(0)
  })

  it('台北車站到板橋車站約 7 公里', () => {
    const d = haversineMeters(
      TAIPEI_STATION.lat, TAIPEI_STATION.lng,
      BANQIAO_STATION.lat, BANQIAO_STATION.lng,
    )
    expect(d).toBeGreaterThan(6000)
    expect(d).toBeLessThan(8000)
  })

  it('對稱', () => {
    const ab = haversineMeters(25.03, 121.52, 25.06, 121.60)
    const ba = haversineMeters(25.06, 121.60, 25.03, 121.52)
    expect(ab).toBeCloseTo(ba, 6)
  })
})

describe('estimateCommuteMinutes', () => {
  it('鄰近軌道站比不鄰近快', () => {
    const near = estimateCommuteMinutes(25.06, 121.60, TAIPEI_STATION.lat, TAIPEI_STATION.lng, true)
    const far = estimateCommuteMinutes(25.06, 121.60, TAIPEI_STATION.lat, TAIPEI_STATION.lng, false)
    expect(near).toBeLessThan(far)
  })

  it('距離越遠時間越長', () => {
    const close = estimateCommuteMinutes(25.05, 121.52, TAIPEI_STATION.lat, TAIPEI_STATION.lng, true)
    const distant = estimateCommuteMinutes(25.13, 121.50, TAIPEI_STATION.lat, TAIPEI_STATION.lng, true)
    expect(distant).toBeGreaterThan(close)
  })

  it('同一點仍有轉乘與步行的基本耗時，不為 0', () => {
    const m = estimateCommuteMinutes(25.0478, 121.5170, TAIPEI_STATION.lat, TAIPEI_STATION.lng, true)
    expect(m).toBeGreaterThan(0)
  })
})
