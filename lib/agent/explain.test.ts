import { describe, expect, it } from 'vitest'
import { buildExplainPrompt } from './explain'
import { makeListing } from '@/lib/test-utils/factory'
import { DEFAULT_PROFILE } from '@/lib/types/profile'
import type { ListingFeatures, ScoredListing } from '@/lib/types/listing'

type ScoredOverride = Partial<Omit<ScoredListing, 'features'>> & {
  features?: Partial<ListingFeatures>
}

// features 走 makeListing 的 Partial 覆寫，測試才能只寫想命中的那幾個 fs* 欄位
const scored = ({ features, ...o }: ScoredOverride = {}): ScoredListing => ({
  ...makeListing({ features }),
  score: 0.7,
  breakdown: {
    price: { subscore: 0.8, weight: 0.15, contribution: 0.12 },
    value: { subscore: 0.65, weight: 0.05, contribution: 0.0325 },
    weather: { subscore: 0.5, weight: 0.15, contribution: 0.075 },
    location: { subscore: 0.6, weight: 0.2, contribution: 0.12 },
    amenities: { subscore: 0.7, weight: 0.2, contribution: 0.14 },
    space: { subscore: 0.6, weight: 0.15, contribution: 0.09 },
    quality: { subscore: 0.5, weight: 0.1, contribution: 0.05 },
    fengshui: { subscore: 0.5, weight: 0, contribution: 0 },
  },
  dataGaps: [],
  ...o,
})

/** makeFeatures 的預設是六項全部檢測過且無虞，測試只覆寫要命中或要抹成未檢測的欄位 */
const ALL_FENGSHUI_UNKNOWN: Partial<ListingFeatures> = {
  fsEntryWindowAligned: null,
  fsEntryScreen: null,
  fsStoveVisibleFromDoor: null,
  fsToiletFacingDoor: null,
  fsBeamOverBed: null,
  fsLivingRoomDepthM: null,
  fsDaylightBlocked: null,
  fsRoadRush: null,
}

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

  it('列出命中的風水項目中文名', () => {
    const p = buildExplainPrompt(
      DEFAULT_PROFILE,
      [scored({ features: { fsEntryWindowAligned: 1, fsToiletFacingDoor: 1 } })],
      [],
    )
    expect(p).toContain('風水：命中 穿堂煞、開門見廁')
  })

  it('未檢測的項目與命中的項目分開列，不把沒判讀說成沒問題', () => {
    const p = buildExplainPrompt(
      DEFAULT_PROFILE,
      [scored({ features: { fsEntryWindowAligned: 1, fsRoadRush: null } })],
      [],
    )
    expect(p).toContain('命中 穿堂煞')
    expect(p).toContain('未檢測 路衝／壁刀')
  })

  it('全部檢測過且無虞時明講無虞', () => {
    const p = buildExplainPrompt(DEFAULT_PROFILE, [scored()], [])
    expect(p).toContain('風水：已檢測項目均無虞')
  })

  it('完全沒有風水證據時只說未檢測，不做任何保證', () => {
    const p = buildExplainPrompt(DEFAULT_PROFILE, [scored({ features: ALL_FENGSHUI_UNKNOWN })], [])
    expect(p).toContain('風水：未檢測 穿堂煞')
    expect(p).not.toContain('無虞')
  })

  it('帶入目前的權重，讓解釋能對應權重', () => {
    const p = buildExplainPrompt({ ...DEFAULT_PROFILE, weights: { ...DEFAULT_PROFILE.weights, price: 90 } }, [scored()], [])
    expect(p).toContain('90')
  })
})
