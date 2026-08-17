import { z } from 'zod'
import { FENGSHUI_RULES } from '@/lib/fengshui/rules'
import type { FengshuiIssueKey } from '@/lib/types/fengshui'
import { DEFAULT_PROFILE, REGIONS, WEIGHT_KEYS, type Region, type SearchProfile } from '@/lib/types/profile'

/** 台灣本島與離島的概略經緯度範圍，用來擋掉模型幻覺出的座標 */
const TW_LAT = { min: 21.5, max: 26.5 }
const TW_LNG = { min: 118.0, max: 122.5 }

const modeSchema = z.enum(['sale', 'rent'])

/**
 * 縣市名的形狀檢查，取代原本的六都白名單。
 *
 * 白名單在「地區是不可放寬的硬條件」之後變成 bug：使用者說「基隆市」會被靜靜丟掉，
 * 於是他拿到一整份雙北的物件，還以為那就是基隆的行情 —— 正是這次要消滅的那種失敗。
 * 形狀不對（模型幻覺出來的句子）仍然擋掉。
 */
const CITY_SHAPE = /^[一-鿿]{2,3}[市縣]$/

/** 台→臺 正規化，避免「台北市」與種子資料的正式全形字「臺北市」被當成兩個不同城市 */
function normalizeCityDistrict(s: string): string {
  return s.replace(/台/g, '臺')
}

function normalizeCities(cities: string[] | undefined): string[] | undefined {
  if (!cities) return cities
  return cities.map(normalizeCityDistrict).filter((c) => CITY_SHAPE.test(c))
}

function normalizeRegions(regions: string[] | undefined): Region[] | undefined {
  const known: readonly string[] = REGIONS
  return regions?.filter((r): r is Region => known.includes(r))
}

function normalizeRegionsNullable(
  regions: string[] | null | undefined,
): Region[] | null | undefined {
  return regions == null ? regions : normalizeRegions(regions)
}

function normalizeDistricts(districts: string[] | undefined): string[] | undefined {
  return districts?.map(normalizeCityDistrict)
}

function normalizeCitiesNullable(cities: string[] | null | undefined): string[] | null | undefined {
  return cities == null ? cities : normalizeCities(cities)
}

function normalizeDistrictsNullable(districts: string[] | null | undefined): string[] | null | undefined {
  return districts == null ? districts : normalizeDistricts(districts)
}

/** 比對用的正規化：忽略大小寫、空白與分隔符，並把異體字「梁」收斂成「樑」，
 *  讓「樑壓床」「梁壓床」「Through Draft」都能對到同一把 key。 */
function fengshuiToken(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_/／、,，\-－]/g, '').replace(/梁/g, '樑')
}

/**
 * 風水忌諱的別名表。模型可能吐英文 key（throughDraft），也可能吐規則的中文名（穿堂煞），
 * 使用者轉述時還會用口語簡稱，全部都要能對回 FengshuiIssueKey。
 * 表以 FENGSHUI_RULES 為單一事實來源，規則改名時不會漏掉這裡。
 */
const FENGSHUI_ALIASES: Record<string, FengshuiIssueKey> = (() => {
  const map: Record<string, FengshuiIssueKey> = {}
  const add = (alias: string, key: FengshuiIssueKey): void => {
    map[fengshuiToken(alias)] = key
  }
  for (const rule of FENGSHUI_RULES) {
    add(rule.key, rule.key)
    // 完整正式名稱一定要註冊：fengshuiToken 會把「／」也去掉，「路衝／壁刀」的 token 是
    // 「路衝壁刀」，只登記拆開的片段反而會讓 prompt／文件裡逐字出現的正式名稱對不到 key
    add(rule.name, rule.key)
    // 「樑壓床／樑壓沙發」「路衝／壁刀」是複合名稱，使用者不會整串照念，拆開各自成立
    for (const part of rule.name.split('／')) add(part, rule.key)
  }
  // 常見口語寫法；不在表內的一律當幻覺丟棄，寧可少一條硬條件也不要濾成 0 筆
  add('穿堂風', 'throughDraft')
  add('門對窗', 'throughDraft')
  add('開門見爐', 'stoveInSight')
  add('門對灶', 'stoveInSight')
  add('開門見廁所', 'toiletFacingDoor')
  add('門對廁', 'toiletFacingDoor')
  add('橫樑壓頂', 'beamPressure')
  add('樑壓頂', 'beamPressure')
  add('明堂窄', 'narrowHall')
  add('明堂不足', 'narrowHall')
  add('路衝煞', 'roadRush')
  return map
})()

/**
 * 認得的值轉成 FengshuiIssueKey 並去重，認不得的直接丟棄（比照 normalizeCities 對幻覺城市的處理）。
 * 全部被丟棄或本來就是空陣列時回 undefined —— 空陣列在 hard 裡沒有意義，
 * 過濾端看的是 `avoidFengshui?.length`，留一個永遠不成立的空條件只會在 UI 上礙眼。
 * undefined 在 delta 端等同「這次沒提到」（mergeProfile 只認 null 為移除），
 * 所以模型吐出一串認不得的風水詞時，使用者先前設好的硬條件會原封不動保留，而不是被無聲清掉。
 */
function normalizeFengshui(list: string[] | undefined): FengshuiIssueKey[] | undefined {
  if (!list) return list
  const out: FengshuiIssueKey[] = []
  for (const raw of list) {
    const key = FENGSHUI_ALIASES[fengshuiToken(raw)]
    if (key && !out.includes(key)) out.push(key)
  }
  return out.length > 0 ? out : undefined
}

function normalizeFengshuiNullable(
  list: string[] | null | undefined,
): FengshuiIssueKey[] | null | undefined {
  return list == null ? list : normalizeFengshui(list)
}

// zod 4 的 z.record + z.enum key 會要求所有 key 都存在（非 partial），
// 不適合「使用者只提到部分維度」的情境，改用逐一列舉 key 的物件形式。
const weightsShape = z.object({
  price: z.number().optional(),
  value: z.number().optional(),
  weather: z.number().optional(),
  location: z.number().optional(),
  amenities: z.number().optional(),
  space: z.number().optional(),
  quality: z.number().optional(),
  hazard: z.number().optional(),
  fengshui: z.number().optional(),
})

const weightsSchema = weightsShape
  .optional()
  .transform((w) => {
    const out = { ...DEFAULT_PROFILE.weights }
    for (const k of WEIGHT_KEYS) {
      const v = w?.[k]
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[k] = Math.min(100, Math.max(0, v))
      }
    }
    return out
  })

const nonNegative = z.number().finite().transform((v) => Math.max(0, v))

const hardSchema = z.object({
  regions: z.array(z.string().min(1)).max(5).optional().transform(normalizeRegions),
  cities: z.array(z.string().min(1)).max(22).optional().transform(normalizeCities),
  districts: z.array(z.string().min(1)).max(30).optional().transform(normalizeDistricts),
  excludedCities: z.array(z.string().min(1)).max(22).optional().transform(normalizeCities),
  excludedDistricts: z.array(z.string().min(1)).max(30).optional().transform(normalizeDistricts),
  budgetMin: nonNegative.optional(),
  budgetMax: nonNegative.optional(),
  minArea: nonNegative.optional(),
  minRooms: z.number().int().min(0).max(10).optional(),
  maxAge: nonNegative.optional(),
  buildingTypes: z.array(z.string().min(1)).max(10).optional(),
  needElevator: z.boolean().optional(),
  needParking: z.boolean().optional(),
  maxDistToMetro: nonNegative.optional(),
  maxCommuteMinutes: nonNegative.optional(),
  near: z.object({
    lat: z.number().min(20).max(27),
    lng: z.number().min(118).max(123),
    radiusKm: z.number().positive().max(200),
    label: z.string().optional(),
  }).optional(),

  // 收 string 而非 enum：模型吐中文名或亂寫時，enum 會讓整個 hard 解析失敗，
  // 這裡改成先收下再正規化，未知值單獨丟棄，其餘條件照常保留。
  // 長度上限刻意放寬到遠大於 6：.max() 在 transform 之前跑，若卡在 6，模型吐出重複值或
  // 幾個幻覺詞就會讓整份 profile 解析失敗退回 DEFAULT_PROFILE（連預算、城市一起消失）。
  // 真正的上限交給 normalizeFengshui 的白名單與去重把關，輸出最多就是 6 個 key。
  avoidFengshui: z.array(z.string().min(1)).max(20).optional().transform(normalizeFengshui),
})

const commuteAnchorSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
    label: z.string().min(1).max(40),
    maxMin: z.number().min(1).max(180).optional(),
  })
  .refine(
    (a) =>
      a.lat >= TW_LAT.min && a.lat <= TW_LAT.max &&
      a.lng >= TW_LNG.min && a.lng <= TW_LNG.max,
    { message: 'commuteAnchor 座標不在台灣範圍內' },
  )

const softSchema = z.object({
  prefersCool: z.boolean().optional(),
  prefersLowRain: z.boolean().optional(),
  prefersQuiet: z.number().min(-1).max(1).optional(),
  // 座標不合法時只丟掉錨點，其餘偏好照常保留
  commuteAnchor: commuteAnchorSchema.optional().catch(undefined),
})

export const searchProfileSchema = z.object({
  mode: modeSchema,
  weights: weightsSchema,
  hard: hardSchema.optional().transform((h) => h ?? {}),
  soft: softSchema.optional().transform((s) => s ?? {}),
  notes: z.array(z.string()).max(10).optional().transform((n) => n ?? []),
})

/** 不拋錯：任何不合法輸入都退回預設 profile，避免整條請求失敗 */
export function parseProfile(input: unknown): SearchProfile {
  const parsed = searchProfileSchema.safeParse(input)
  return parsed.success ? parsed.data : structuredClone(DEFAULT_PROFILE)
}

const clampDelta = z
  .number()
  .finite()
  .transform((v) => Math.min(100, Math.max(-100, v)))

const weightsDeltaSchema = z.object({
  price: clampDelta.optional(),
  value: clampDelta.optional(),
  weather: clampDelta.optional(),
  location: clampDelta.optional(),
  amenities: clampDelta.optional(),
  space: clampDelta.optional(),
  quality: clampDelta.optional(),
  hazard: clampDelta.optional(),
  fengshui: clampDelta.optional(),
})

const hardDeltaSchema = z.object({
  regions: z.array(z.string().min(1)).max(5).nullable().optional().transform(normalizeRegionsNullable),
  cities: z.array(z.string().min(1)).max(22).nullable().optional().transform(normalizeCitiesNullable),
  districts: z.array(z.string().min(1)).max(30).nullable().optional().transform(normalizeDistrictsNullable),
  excludedCities: z.array(z.string().min(1)).max(22).nullable().optional().transform(normalizeCitiesNullable),
  excludedDistricts: z.array(z.string().min(1)).max(30).nullable().optional().transform(normalizeDistrictsNullable),
  budgetMin: nonNegative.nullable().optional(),
  budgetMax: nonNegative.nullable().optional(),
  minArea: nonNegative.nullable().optional(),
  minRooms: z.number().int().min(0).max(10).nullable().optional(),
  maxAge: nonNegative.nullable().optional(),
  buildingTypes: z.array(z.string().min(1)).max(10).nullable().optional(),
  needElevator: z.boolean().nullable().optional(),
  needParking: z.boolean().nullable().optional(),
  maxDistToMetro: nonNegative.nullable().optional(),
  maxCommuteMinutes: nonNegative.nullable().optional(),
  near: z.object({
    lat: z.number().min(20).max(27),
    lng: z.number().min(118).max(123),
    radiusKm: z.number().positive().max(200),
    label: z.string().nullable().optional(),
  }).nullable().optional(),

  // 上限同 hardSchema：卡在 6 會讓整包 delta 解析失敗，使用者同一句話裡講的其他條件一併消失
  avoidFengshui: z
    .array(z.string().min(1))
    .max(20)
    .nullable()
    .optional()
    .transform(normalizeFengshuiNullable),
})

/** 模型輸出的變動量。未知欄位一律丟棄，不讓單一幻覺欄位炸掉整包。 */
export const profileDeltaSchema = z.object({
  mode: modeSchema.optional(),
  weightsDelta: weightsDeltaSchema.optional(),
  hard: hardDeltaSchema.optional(),
  soft: softSchema.optional(),
  note: z.string().max(200).optional(),
})

export type ParsedProfileDelta = z.infer<typeof profileDeltaSchema>
