import { describe, expect, it } from 'vitest'
import { buildContents, parseFunctionCall } from './extract'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'
import type { ChatMessage } from '@/lib/types/chat'

const profile = (o: Partial<SearchProfile> = {}): SearchProfile => ({ ...DEFAULT_PROFILE, ...o })

describe('parseFunctionCall', () => {
  it('解析合法的權重變動', () => {
    expect(parseFunctionCall({ weightsDelta: { location: 20 } })).toEqual({ weightsDelta: { location: 20 } })
  })

  it('丟棄未知欄位，保留合法欄位', () => {
    const d = parseFunctionCall({ weightsDelta: { price: 15 }, 幻覺欄位: '亂寫' })
    expect(d.weightsDelta).toEqual({ price: 15 })
    expect(d).not.toHaveProperty('幻覺欄位')
  })

  it('權重超出範圍時 clamp 而非整包失敗', () => {
    expect(parseFunctionCall({ weightsDelta: { price: 9999 } }).weightsDelta?.price).toBe(100)
  })

  it('台灣範圍外的 commuteAnchor 被丟棄，其餘 soft 偏好保留', () => {
    const d = parseFunctionCall({
      soft: { prefersCool: true, commuteAnchor: { lat: 48.8, lng: 2.3, label: '巴黎' } },
    })
    expect(d.soft?.prefersCool).toBe(true)
    expect(d.soft?.commuteAnchor).toBeUndefined()
  })

  it('完全不合法的輸入回空 delta，不拋錯', () => {
    expect(parseFunctionCall('垃圾')).toEqual({})
    expect(parseFunctionCall(null)).toEqual({})
    expect(parseFunctionCall(undefined)).toEqual({})
  })

  it('接受完整的一次萃取', () => {
    const d = parseFunctionCall({
      mode: 'rent',
      weightsDelta: { location: 25, price: 10 },
      hard: { budgetMax: 25000, minRooms: 2 },
      soft: { prefersQuiet: 1, commuteAnchor: { lat: 25.033, lng: 121.565, label: '信義區', maxMin: 40 } },
      note: '在信義區上班，想安靜一點',
    })
    expect(d.mode).toBe('rent')
    expect(d.hard?.budgetMax).toBe(25000)
    expect(d.soft?.commuteAnchor?.label).toBe('信義區')
    expect(d.note).toContain('信義區')
  })
})

describe('buildContents', () => {
  it('把對話轉成 Gemini 的 contents 格式', () => {
    const contents = buildContents(
      [{ role: 'user', content: '我想找台北的房子' }],
      profile(),
    )
    expect(contents.at(-1)?.role).toBe('user')
    expect(JSON.stringify(contents)).toContain('我想找台北的房子')
  })

  it('assistant 角色轉為 model', () => {
    const contents = buildContents(
      [{ role: 'user', content: '你好' }, { role: 'assistant', content: '哈囉' }, { role: 'user', content: '繼續' }],
      profile(),
    )
    expect(contents[1].role).toBe('model')
  })

  it('只保留最近 6 輪對話', () => {
    const many: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `訊息${i}`,
    }))
    const contents = buildContents(many, profile())
    expect(contents.length).toBeLessThanOrEqual(13) // 12 則對話 + 1 則現況說明
    expect(JSON.stringify(contents)).not.toContain('訊息0')
  })

  it('把目前的 profile 現況帶進去，讓模型知道要做增量', () => {
    const contents = buildContents(
      [{ role: 'user', content: '再便宜一點' }],
      profile({ weights: { ...DEFAULT_PROFILE.weights, price: 80 } }),
    )
    expect(JSON.stringify(contents)).toContain('80')
  })

  it('空對話仍回傳含現況的 contents', () => {
    expect(buildContents([], profile()).length).toBeGreaterThan(0)
  })
})
