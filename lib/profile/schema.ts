import { z } from 'zod'
import { DEFAULT_PROFILE, WEIGHT_KEYS, type SearchProfile } from '@/lib/types/profile'

/** 台灣本島與離島的概略經緯度範圍，用來擋掉模型幻覺出的座標 */
const TW_LAT = { min: 21.5, max: 26.5 }
const TW_LNG = { min: 118.0, max: 122.5 }

const modeSchema = z.enum(['sale', 'rent'])

// zod 4 的 z.record + z.enum key 會要求所有 key 都存在（非 partial），
// 不適合「使用者只提到部分維度」的情境，改用逐一列舉 key 的物件形式。
const weightsShape = z.object({
  price: z.number().optional(),
  weather: z.number().optional(),
  location: z.number().optional(),
  amenities: z.number().optional(),
  space: z.number().optional(),
  quality: z.number().optional(),
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
  cities: z.array(z.string().min(1)).max(6).optional(),
  districts: z.array(z.string().min(1)).max(30).optional(),
  budgetMin: nonNegative.optional(),
  budgetMax: nonNegative.optional(),
  minArea: nonNegative.optional(),
  minRooms: z.number().int().min(0).max(10).optional(),
  maxAge: nonNegative.optional(),
  buildingTypes: z.array(z.string().min(1)).max(10).optional(),
  needElevator: z.boolean().optional(),
  needParking: z.boolean().optional(),
  maxDistToMetro: nonNegative.optional(),
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
  weather: clampDelta.optional(),
  location: clampDelta.optional(),
  amenities: clampDelta.optional(),
  space: clampDelta.optional(),
  quality: clampDelta.optional(),
})

const hardDeltaSchema = z.object({
  cities: z.array(z.string().min(1)).max(6).nullable().optional(),
  districts: z.array(z.string().min(1)).max(30).nullable().optional(),
  budgetMin: nonNegative.nullable().optional(),
  budgetMax: nonNegative.nullable().optional(),
  minArea: nonNegative.nullable().optional(),
  minRooms: z.number().int().min(0).max(10).nullable().optional(),
  maxAge: nonNegative.nullable().optional(),
  buildingTypes: z.array(z.string().min(1)).max(10).nullable().optional(),
  needElevator: z.boolean().nullable().optional(),
  needParking: z.boolean().nullable().optional(),
  maxDistToMetro: nonNegative.nullable().optional(),
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
