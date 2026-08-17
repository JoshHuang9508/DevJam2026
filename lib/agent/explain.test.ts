import { describe, expect, it } from 'vitest'
import { buildExplainPrompt } from './explain'
import { makeListing } from '@/lib/test-utils/factory'
import { DEFAULT_PROFILE } from '@/lib/types/profile'
import type { ScoredListing } from '@/lib/types/listing'

const scored = (o: Partial<ScoredListing> = {}): ScoredListing => ({
  ...makeListing(),
  score: 0.7,
  breakdown: {
    price: { subscore: 0.8, weight: 0.15, contribution: 0.12 },
    value: { subscore: 0.65, weight: 0.05, contribution: 0.0325 },
    weather: { subscore: 0.5, weight: 0.15, contribution: 0.075 },
    location: { subscore: 0.6, weight: 0.2, contribution: 0.12 },
    amenities: { subscore: 0.7, weight: 0.2, contribution: 0.14 },
    space: { subscore: 0.6, weight: 0.15, contribution: 0.09 },
    quality: { subscore: 0.5, weight: 0.1, contribution: 0.05 },
  },
  dataGaps: [],
  ...o,
})

describe('buildExplainPrompt', () => {
  it('包含前幾筆物件的關鍵欄位', () => {
    const p = buildExplainPrompt(DEFAULT_PROFILE, [scored({ district: '大安區', age: 32 })], [])
    expect(p).toContain('大安區')
    expect(p).toContain('32')
  })

  it('最多帶 5 筆物件，避免 prompt 過長', () => {
    const many = Array.from({ length: 30 }, (_, i) => scored({ id: `L${i}`, title: `物件${i}` }))
    const p = buildExplainPrompt(DEFAULT_PROFILE, many, [])
    expect(p).toContain('物件4')
    expect(p).not.toContain('物件5')
  })

  it('有放寬條件時明列出來', () => {
    const p = buildExplainPrompt(DEFAULT_PROFILE, [scored()], ['把預算上限放寬到 1150'])
    expect(p).toContain('已放寬的條件')
    expect(p).toContain('1150')
  })

  it('有資料缺口時列出來', () => {
    const p = buildExplainPrompt(DEFAULT_PROFILE, [scored({ dataGaps: ['aqiMean'] })], [])
    expect(p).toContain('aqiMean')
  })

  it('0 筆結果時要求模型說明並提出放寬建議', () => {
    const p = buildExplainPrompt(DEFAULT_PROFILE, [], ['放寬所有條件後仍找不到符合的物件'])
    expect(p).toContain('沒有找到')
  })

  it('帶入目前的權重，讓解釋能對應權重', () => {
    const p = buildExplainPrompt({ ...DEFAULT_PROFILE, weights: { ...DEFAULT_PROFILE.weights, price: 90 } }, [scored()], [])
    expect(p).toContain('90')
  })
})
