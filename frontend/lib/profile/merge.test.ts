import { describe, expect, it } from 'vitest'
import { mergeProfile } from './merge'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'

const base = (o: Partial<SearchProfile> = {}): SearchProfile =>
  structuredClone({ ...DEFAULT_PROFILE, ...o })

describe('mergeProfile', () => {
  it('權重是增量疊加，未提及的維度不動', () => {
    const out = mergeProfile(base(), { weightsDelta: { location: 20 } })
    expect(out.weights.location).toBe(70)
    expect(out.weights.price).toBe(50)
  })

  it('權重 clamp 在 0..100', () => {
    const high = mergeProfile(base(), { weightsDelta: { price: 999 } })
    const low = mergeProfile(base(), { weightsDelta: { price: -999 } })
    expect(high.weights.price).toBe(100)
    expect(low.weights.price).toBe(0)
  })

  it('hard 條件覆蓋既有值', () => {
    const out = mergeProfile(base({ hard: { budgetMax: 2000 } }), { hard: { budgetMax: 1500 } })
    expect(out.hard.budgetMax).toBe(1500)
  })

  it('hard 中未提及的欄位保留', () => {
    const out = mergeProfile(base({ hard: { budgetMax: 2000, minRooms: 2 } }), { hard: { minRooms: 3 } })
    expect(out.hard.budgetMax).toBe(2000)
    expect(out.hard.minRooms).toBe(3)
  })

  it('hard 欄位設為 null 表示移除該條件', () => {
    const out = mergeProfile(base({ hard: { budgetMax: 2000 } }), { hard: { budgetMax: null } })
    expect(out.hard.budgetMax).toBeUndefined()
  })

  it('hard 欄位是 undefined 時視為「這次沒提到」，不移除既有條件', () => {
    // zod 的 transform 回 undefined 時 key 仍留在物件上（avoidFengshui 收到一串認不得的
    // 風水詞就是這種情形）。若把 undefined 也當成移除，使用者上一輪設好的硬條件會被無聲清掉。
    const out = mergeProfile(
      base({ hard: { avoidFengshui: ['throughDraft'], budgetMax: 2000 } }),
      { hard: { avoidFengshui: undefined } },
    )
    expect(out.hard.avoidFengshui).toEqual(['throughDraft'])
    expect(out.hard.budgetMax).toBe(2000)
  })

  it('soft 偏好合併', () => {
    const out = mergeProfile(base({ soft: { prefersCool: true } }), { soft: { prefersQuiet: 1 } })
    expect(out.soft.prefersCool).toBe(true)
    expect(out.soft.prefersQuiet).toBe(1)
  })

  it('note 累加到 notes', () => {
    const out = mergeProfile(base({ notes: ['第一句'] }), { note: '第二句' })
    expect(out.notes).toEqual(['第一句', '第二句'])
  })

  it('notes 最多保留最近 10 筆', () => {
    const many = Array.from({ length: 10 }, (_, i) => `n${i}`)
    const out = mergeProfile(base({ notes: many }), { note: 'new' })
    expect(out.notes).toHaveLength(10)
    expect(out.notes.at(-1)).toBe('new')
    expect(out.notes[0]).toBe('n1')
  })

  it('切換 mode 時清空預算條件（買賣與租金量級不同）', () => {
    const out = mergeProfile(
      base({ mode: 'sale', hard: { budgetMax: 2000, budgetMin: 800, minRooms: 2 } }),
      { mode: 'rent' },
    )
    expect(out.mode).toBe('rent')
    expect(out.hard.budgetMax).toBeUndefined()
    expect(out.hard.budgetMin).toBeUndefined()
    expect(out.hard.minRooms).toBe(2)
  })

  it('mode 不變時不清空預算', () => {
    const out = mergeProfile(base({ mode: 'sale', hard: { budgetMax: 2000 } }), { mode: 'sale' })
    expect(out.hard.budgetMax).toBe(2000)
  })

  it('切換 mode 時，同批 delta 帶來的新預算不被清掉', () => {
    const out = mergeProfile(
      base({ mode: 'sale', hard: { budgetMax: 2000 } }),
      { mode: 'rent', hard: { budgetMax: 25000 } },
    )
    expect(out.hard.budgetMax).toBe(25000)
  })

  it('不修改傳入的 profile', () => {
    const original = base()
    mergeProfile(original, { weightsDelta: { price: 30 }, note: 'x' })
    expect(original.weights.price).toBe(50)
    expect(original.notes).toEqual([])
  })

  it('空 delta 回傳等值的 profile', () => {
    const original = base({ hard: { budgetMax: 1500 } })
    expect(mergeProfile(original, {})).toEqual(original)
  })
})
