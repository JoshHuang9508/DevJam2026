import { describe, expect, it } from 'vitest'
import { parseProfile, profileDeltaSchema } from './schema'
import { DEFAULT_PROFILE, WEIGHT_KEYS } from '@/lib/types/profile'

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

  it('舊版 localStorage 的 profile（沒有 fengshui 欄位）遷移後 fengshui 為 0', () => {
    // 這條釘住既有排序零回歸：舊 payload 若讓 fengshui 變成 undefined，
    // normalizeWeights 會算出 NaN，整份排序崩掉
    const legacy = {
      mode: 'sale',
      weights: { price: 50, value: 50, weather: 50, location: 50, amenities: 50, space: 50, quality: 50 },
      hard: {},
      soft: {},
      notes: [],
    }
    const p = parseProfile(legacy)
    expect(p.weights.fengshui).toBe(0)
    expect(Number.isFinite(p.weights.fengshui)).toBe(true)
    expect(Object.keys(p.weights).sort()).toEqual([...WEIGHT_KEYS].sort())
  })

  it('明確給定的 fengshui 權重會被保留', () => {
    const p = parseProfile({ ...DEFAULT_PROFILE, weights: { ...DEFAULT_PROFILE.weights, fengshui: 60 } })
    expect(p.weights.fengshui).toBe(60)
  })
})

describe('avoidFengshui 正規化', () => {
  it('接受英文 key', () => {
    const p = parseProfile({ ...DEFAULT_PROFILE, hard: { avoidFengshui: ['throughDraft'] } })
    expect(p.hard.avoidFengshui).toEqual(['throughDraft'])
  })

  it('接受中文名並轉成 key', () => {
    const p = parseProfile({
      ...DEFAULT_PROFILE,
      hard: { avoidFengshui: ['穿堂煞', '開門見廁', '路衝'] },
    })
    expect(p.hard.avoidFengshui).toEqual(['throughDraft', 'toiletFacingDoor', 'roadRush'])
  })

  it('異體字與複合名稱的一半都認得', () => {
    const p = parseProfile({ ...DEFAULT_PROFILE, hard: { avoidFengshui: ['梁壓沙發', '壁刀'] } })
    expect(p.hard.avoidFengshui).toEqual(['beamPressure', 'roadRush'])
  })

  it('認不得的值直接丟棄，其餘保留', () => {
    const p = parseProfile({
      ...DEFAULT_PROFILE,
      hard: { avoidFengshui: ['五鬼運財', '穿堂煞'], budgetMax: 1500 },
    })
    expect(p.hard.avoidFengshui).toEqual(['throughDraft'])
    expect(p.hard.budgetMax).toBe(1500)
  })

  it('全部認不得時收斂成 undefined，不留空條件', () => {
    const p = parseProfile({ ...DEFAULT_PROFILE, hard: { avoidFengshui: ['青龍白虎'] } })
    expect(p.hard.avoidFengshui).toBeUndefined()
  })

  it('重複項目去重', () => {
    const p = parseProfile({
      ...DEFAULT_PROFILE,
      hard: { avoidFengshui: ['穿堂煞', 'throughDraft', '穿堂風'] },
    })
    expect(p.hard.avoidFengshui).toEqual(['throughDraft'])
  })

  it('完整正式名稱（含分隔的「／」）也認得', () => {
    const p = parseProfile({
      ...DEFAULT_PROFILE,
      hard: { avoidFengshui: ['路衝／壁刀', '樑壓床／樑壓沙發'] },
    })
    expect(p.hard.avoidFengshui).toEqual(['roadRush', 'beamPressure'])
  })

  it('超過 6 個字串不會讓整份 profile 退回預設', () => {
    const p = parseProfile({
      ...DEFAULT_PROFILE,
      mode: 'rent',
      hard: {
        budgetMax: 30000,
        cities: ['臺北市'],
        avoidFengshui: [
          'throughDraft', 'throughDraft', 'roadRush', 'narrowHall',
          'beamPressure', 'stoveInSight', 'toiletFacingDoor',
        ],
      },
    })
    expect(p.mode).toBe('rent')
    expect(p.hard.budgetMax).toBe(30000)
    expect(p.hard.cities).toEqual(['臺北市'])
    expect(p.hard.avoidFengshui).toHaveLength(6)
  })
})

describe('城市／行政區正規化', () => {
  it('台北市正規化為臺北市', () => {
    const p = parseProfile({ ...DEFAULT_PROFILE, hard: { cities: ['台北市'] } })
    expect(p.hard.cities).toEqual(['臺北市'])
  })

  it('未知城市被丟棄，不讓幻覺城市把候選池濾成 0 筆', () => {
    const p = parseProfile({ ...DEFAULT_PROFILE, hard: { cities: ['克拉克市'] } })
    expect(p.hard.cities).toEqual([])
  })

  it('已知城市保留', () => {
    const p = parseProfile({ ...DEFAULT_PROFILE, hard: { cities: ['高雄市'] } })
    expect(p.hard.cities).toEqual(['高雄市'])
  })

  it('行政區只做字元正規化，不做白名單過濾', () => {
    const p = parseProfile({ ...DEFAULT_PROFILE, hard: { districts: ['台北車站特區'] } })
    expect(p.hard.districts).toEqual(['臺北車站特區'])
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

  it('weightsDelta 收得到 fengshui', () => {
    const d = profileDeltaSchema.parse({ weightsDelta: { fengshui: 25 } })
    expect(d.weightsDelta?.fengshui).toBe(25)
  })

  it('hard.avoidFengshui 的中文名同樣被正規化', () => {
    const d = profileDeltaSchema.parse({ hard: { avoidFengshui: ['開門見灶', '亂寫的煞'] } })
    expect(d.hard?.avoidFengshui).toEqual(['stoveInSight'])
  })

  it('hard.avoidFengshui 傳 null 表示移除', () => {
    const d = profileDeltaSchema.parse({ hard: { avoidFengshui: null } })
    expect(d.hard?.avoidFengshui).toBeNull()
  })

  it('hard.avoidFengshui 全被丟棄時收斂成 undefined（mergeProfile 只認 null 為移除，不會清掉舊條件）', () => {
    const d = profileDeltaSchema.parse({ hard: { avoidFengshui: ['幻覺煞'] } })
    expect(d.hard?.avoidFengshui).toBeUndefined()
  })

  it('avoidFengshui 超過 6 個字串不會炸掉整包 delta，同句話的其他條件照常保留', () => {
    // .max() 在 transform 之前跑：卡在 6 的話，模型多吐幾個重複／幻覺值就會讓整包解析失敗，
    // 使用者同一句話裡講的預算也一起消失，畫面完全沒變
    const d = profileDeltaSchema.parse({
      hard: {
        budgetMax: 30000,
        avoidFengshui: [
          'throughDraft', 'throughDraft', 'roadRush', 'narrowHall',
          'beamPressure', 'stoveInSight', 'toiletFacingDoor',
        ],
      },
    })
    expect(d.hard?.budgetMax).toBe(30000)
    expect(d.hard?.avoidFengshui).toEqual([
      'throughDraft', 'roadRush', 'narrowHall', 'beamPressure', 'stoveInSight', 'toiletFacingDoor',
    ])
  })

  it('規則的完整正式名稱（含「／」）也認得', () => {
    // tools.ts 與文件裡逐字出現的是完整名稱，模型很可能整串照抄回來
    const d = profileDeltaSchema.parse({ hard: { avoidFengshui: ['路衝／壁刀', '樑壓床／樑壓沙發'] } })
    expect(d.hard?.avoidFengshui).toEqual(['roadRush', 'beamPressure'])
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
