import { describe, expect, it } from 'vitest'
import { parseProfile, profileDeltaSchema } from './schema'
import { DEFAULT_PROFILE } from '@/lib/types/profile'

describe('parseProfile', () => {
  it('接受合法的 profile', () => {
    const p = parseProfile({ ...DEFAULT_PROFILE, hard: { budgetMax: 1500 } })
    expect(p.hard.budgetMax).toBe(1500)
  })

  it('完全不合法時退回預設 profile，不拋錯', () => {
    expect(parseProfile('垃圾')).toEqual(DEFAULT_PROFILE)
    expect(parseProfile(null)).toEqual(DEFAULT_PROFILE)
    expect(parseProfile({ mode: '亂寫' })).toEqual(DEFAULT_PROFILE)
  })

  it('權重越界時 clamp 而非整包失敗', () => {
    const p = parseProfile({ ...DEFAULT_PROFILE, weights: { ...DEFAULT_PROFILE.weights, price: 500 } })
    expect(p.weights.price).toBe(100)
  })

  it('缺少的權重維度補回預設值', () => {
    const p = parseProfile({ ...DEFAULT_PROFILE, weights: { price: 80 } })
    expect(p.weights.price).toBe(80)
    expect(p.weights.weather).toBe(50)
  })
})

describe('profileDeltaSchema', () => {
  it('接受空物件', () => {
    expect(profileDeltaSchema.parse({})).toEqual({})
  })

  it('weightsDelta clamp 在 -100..100', () => {
    const d = profileDeltaSchema.parse({ weightsDelta: { price: 9999 } })
    expect(d.weightsDelta?.price).toBe(100)
  })

  it('丟棄未知欄位而不是整包失敗', () => {
    const d = profileDeltaSchema.parse({ 亂寫: 1, weightsDelta: { price: 10 } })
    expect(d).not.toHaveProperty('亂寫')
    expect(d.weightsDelta?.price).toBe(10)
  })

  it('負的預算被 clamp 到 0', () => {
    const d = profileDeltaSchema.parse({ hard: { budgetMax: -5 } })
    expect(d.hard?.budgetMax).toBe(0)
  })

  it('hard 欄位可傳 null 表示移除', () => {
    const d = profileDeltaSchema.parse({ hard: { budgetMax: null } })
    expect(d.hard?.budgetMax).toBeNull()
  })

  it('commuteAnchor 座標超出台灣範圍時整個錨點被丟棄', () => {
    const d = profileDeltaSchema.parse({ soft: { commuteAnchor: { lat: 80, lng: 10, label: '北極' } } })
    expect(d.soft?.commuteAnchor).toBeUndefined()
  })

  it('接受台灣範圍內的 commuteAnchor', () => {
    const d = profileDeltaSchema.parse({
      soft: { commuteAnchor: { lat: 25.033, lng: 121.565, label: '信義區', maxMin: 40 } },
    })
    expect(d.soft?.commuteAnchor?.label).toBe('信義區')
  })
})
