import { describe, expect, it } from 'vitest'
import { minMaxNormalize } from './normalize'

describe('minMaxNormalize', () => {
  it('把值線性映射到 0..1', () => {
    expect(minMaxNormalize([0, 5, 10])).toEqual([0, 0.5, 1])
  })

  it('全部相同時一律回 0.5，不得產生 NaN', () => {
    const out = minMaxNormalize([7, 7, 7])
    expect(out).toEqual([0.5, 0.5, 0.5])
    expect(out.some(Number.isNaN)).toBe(false)
  })

  it('單一元素回 0.5', () => {
    expect(minMaxNormalize([42])).toEqual([0.5])
  })

  it('空陣列回空陣列', () => {
    expect(minMaxNormalize([])).toEqual([])
  })

  it('處理負值', () => {
    expect(minMaxNormalize([-10, 0, 10])).toEqual([0, 0.5, 1])
  })
})
