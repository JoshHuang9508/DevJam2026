import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadPool } from './client'

const DB_PATH = './data/app.db'

describe('loadPool', () => {
  it('資料庫存在（未建立請先跑 pnpm db:push && pnpm db:seed）', () => {
    expect(existsSync(DB_PATH)).toBe(true)
  })

  it('載入買賣物件並附上特徵', () => {
    const pool = loadPool('sale')
    expect(pool).toHaveLength(180)
    expect(pool.every((l) => l.mode === 'sale')).toBe(true)
    const first = pool[0]
    expect(first.features).toBeDefined()
    expect(typeof first.features.summerTemp).toBe('number')
    expect(typeof first.features.pricePercentile).toBe('number')
    // listing_features 的主鍵欄位不應洩漏進 features
    expect(first.features).not.toHaveProperty('listingId')
  })

  it('載入租賃物件', () => {
    expect(loadPool('rent')).toHaveLength(180)
  })

  it('依城市篩選', () => {
    const pool = loadPool('sale', ['臺北市'])
    expect(pool.length).toBeGreaterThan(0)
    expect(pool.every((l) => l.city === '臺北市')).toBe(true)
  })

  it('城市不存在時回空陣列而非拋錯', () => {
    expect(loadPool('sale', ['不存在市'])).toEqual([])
  })
})
