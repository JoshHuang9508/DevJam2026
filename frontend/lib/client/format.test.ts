import { describe, expect, it } from 'vitest'
import { formatArea, formatCommute, formatDistance, formatPrice } from './format'

describe('formatPrice', () => {
  it('買賣以「萬」為單位，超過一億改用「億」', () => {
    expect(formatPrice({ mode: 'sale', price: 1580 })).toBe('1,580 萬')
    expect(formatPrice({ mode: 'sale', price: 12000 })).toBe('1.2 億')
  })

  it('租賃以「元/月」表示並加千分位', () => {
    expect(formatPrice({ mode: 'rent', price: 25000 })).toBe('25,000 元/月')
  })
})

describe('formatArea', () => {
  it('保留一位小數並加單位', () => {
    expect(formatArea(25.44)).toBe('25.4 坪')
  })
})

describe('formatDistance', () => {
  it('未滿 1 公里用公尺', () => {
    expect(formatDistance(650)).toBe('650 公尺')
  })

  it('滿 1 公里改用公里', () => {
    expect(formatDistance(2400)).toBe('2.4 公里')
  })

  it('null 顯示為資料不足', () => {
    expect(formatDistance(null)).toBe('—')
  })
})

describe('formatCommute', () => {
  it('四捨五入到分鐘並標示為估計值', () => {
    expect(formatCommute(28.6)).toBe('約 29 分鐘')
  })

  it('null 顯示為資料不足', () => {
    expect(formatCommute(null)).toBe('—')
  })
})
