import { z } from "zod";

const weight = z.number().min(0).max(1);
const preferenceLevel = z.enum(["low", "medium", "high"]);
const hardConstraintsSchemaBase = z.object({
  regions: z.array(z.enum(["北部", "中部", "南部", "東部", "離島"])).optional(),
  cities: z.array(z.string().min(1)).optional(),
  districts: z.array(z.string().min(1)).optional(),
  excludedCities: z.array(z.string().min(1)).optional(),
  excludedDistricts: z.array(z.string().min(1)).optional(),
  minMonthlyRent: z.number().int().nonnegative().optional(),
  maxMonthlyRent: z.number().int().positive().optional(),
  // 買賣總價，單位**萬元**（與前端的 listing.price 同單位）。
  // 沒有這兩個欄位的話，買賣模式下的「預算兩千萬」完全無處可存 ——
  // agent 聽懂了也記不下來，結果就是預算被靜默忽略。
  minTotalPriceWan: z.number().int().nonnegative().optional(),
  maxTotalPriceWan: z.number().int().positive().optional(),
  maxCommuteMinutes: z.number().int().positive().max(240).optional(),
});
const hardConstraintsSchema = hardConstraintsSchemaBase.superRefine((value, ctx) => {
  if (value.minMonthlyRent !== undefined && value.maxMonthlyRent !== undefined && value.minMonthlyRent > value.maxMonthlyRent) {
    ctx.addIssue({ code: "custom", message: "minMonthlyRent cannot exceed maxMonthlyRent" });
  }
  if (value.minTotalPriceWan !== undefined && value.maxTotalPriceWan !== undefined && value.minTotalPriceWan > value.maxTotalPriceWan) {
    ctx.addIssue({ code: "custom", message: "minTotalPriceWan cannot exceed maxTotalPriceWan" });
  }
});

/** 風水忌諱代號，與前端 lib/types/fengshui.ts 的 FengshuiIssueKey 對齊。 */
const fengshuiIssue = z.enum([
  "throughDraft", "stoveInSight", "toiletFacingDoor", "beamPressure", "narrowHall", "roadRush",
]);

/**
 * 物件層級的意圖。這裡的欄位**不參與行政區排序** —— ranking engine 的 dimensions 是寫死的
 * 五維（見 domain/ranking/engine.ts），完全不讀這個區塊；後端只負責存下來、回傳給前端，
 * 真正拿它排物件的是前端的 lib/scoring。
 *
 * 刻意放在 softPreferences 之外：放進去會讓它看起來像第六個排序維度，而行政區沒有「風水」
 * 這種屬性 —— 穿堂煞是某一戶的格局，不是某一區的性質。
 *
 * 存在的理由是 agent 需要一個地方寫入「我很在意風水」「絕對不要穿堂煞」。前端已經沒有
 * 自己的萃取器（Gemini 路徑於 7c5bdaf 移除），這個 agent 是唯一能把自然語言轉成條件的地方。
 *
 * 欄位刻意不帶 `.default()`：patch 走的是 `.partial()`，而欄位層的 default 在 key 缺席時
 * 仍然會補值，deepMerge 便會用那個 default 覆蓋掉既有狀態 —— 只想改 avoidFengshui 卻把
 * fengshuiWeight 打回 0。預設值一律掛在物件層（見 preferenceStateSchema）。
 */
const listingPreferencesSchema = z.object({
  fengshuiWeight: weight,
  avoidFengshui: z.array(fengshuiIssue),
});

export const preferenceStateSchema = z.object({
  version: z.number().int().positive().default(1),
  hardConstraints: hardConstraintsSchema,
  listingPreferences: listingPreferencesSchema.default({ fengshuiWeight: 0, avoidFengshui: [] }),
  softPreferences: z.object({
    housing: z.object({
      weight,
      preferLowerRent: weight.default(1),
    }),
    climate: z.object({
      weight,
      temperature: z.object({
        preferredMin: z.number().min(-10).max(45).optional(),
        preferredMax: z.number().min(-10).max(45).optional(),
        weight,
      }),
      rainfall: z.object({ preference: preferenceLevel, weight }),
      humidity: z.object({ preference: preferenceLevel, weight }),
    }),
    transportation: z.object({
      weight,
      railwayAccess: weight,
      highSpeedRailAccess: weight,
      mrtAccess: weight,
      busAccess: weight,
    }),
    amenities: z.object({
      weight,
      convenienceStore: weight,
      supermarket: weight,
      hospital: weight,
      clinic: weight,
      restaurant: weight,
      school: weight,
      park: weight,
    }),
    geography: z.object({
      weight,
      urbanDensity: weight,
      elevation: weight,
      coastalPreference: z.number().min(-1).max(1),
    }),
  }),
});

export type PreferenceState = z.infer<typeof preferenceStateSchema>;

export const defaultPreferenceState: PreferenceState = preferenceStateSchema.parse({
  hardConstraints: {},
  // 風水預設 0：信仰性偏好必須由使用者主動說出口才 opt-in，權重 0 對總分沒有貢獻。
  listingPreferences: { fengshuiWeight: 0, avoidFengshui: [] },
  softPreferences: {
    housing: { weight: 0.5, preferLowerRent: 1 },
    climate: {
      weight: 0.5,
      temperature: { preferredMin: 18, preferredMax: 28, weight: 0.5 },
      rainfall: { preference: "medium", weight: 0.5 },
      humidity: { preference: "medium", weight: 0.3 },
    },
    transportation: { weight: 0.5, railwayAccess: 0.5, highSpeedRailAccess: 0.3, mrtAccess: 0.5, busAccess: 0.4 },
    amenities: { weight: 0.5, convenienceStore: 0.5, supermarket: 0.6, hospital: 0.6, clinic: 0.3, restaurant: 0.3, school: 0.2, park: 0.3 },
    geography: { weight: 0.2, urbanDensity: 0.5, elevation: 0.1, coastalPreference: 0 },
  },
});

export const preferencePatchSchema = preferenceStateSchema.partial().extend({
  hardConstraints: hardConstraintsSchemaBase.partial().optional(),
  listingPreferences: listingPreferencesSchema.partial().optional(),
  softPreferences: preferenceStateSchema.shape.softPreferences.partial().extend({
    // housing 的 shape 刻意不從 state schema 推導：state 的 preferLowerRent 帶 `.default(1)`，
    // 而 `.partial()` 擋不住欄位層的 default —— key 缺席時仍會補 1，deepMerge 就用那個 1
    // 覆蓋掉使用者先前設過的值。「我更重視租金」這種只動 weight 的 patch 會把
    // preferLowerRent 靜默打回 1。這裡改寫成不帶 default 的版本，缺席就是缺席。
    housing: z.object({ weight, preferLowerRent: weight }).partial().optional(),
    climate: preferenceStateSchema.shape.softPreferences.shape.climate.partial().extend({
      temperature: preferenceStateSchema.shape.softPreferences.shape.climate.shape.temperature.partial().optional(),
      rainfall: preferenceStateSchema.shape.softPreferences.shape.climate.shape.rainfall.partial().optional(),
      humidity: preferenceStateSchema.shape.softPreferences.shape.climate.shape.humidity.partial().optional(),
    }).optional(),
    transportation: preferenceStateSchema.shape.softPreferences.shape.transportation.partial().optional(),
    amenities: preferenceStateSchema.shape.softPreferences.shape.amenities.partial().optional(),
    geography: preferenceStateSchema.shape.softPreferences.shape.geography.partial().optional(),
  }).optional(),
}).omit({ version: true });

export type PreferencePatch = z.infer<typeof preferencePatchSchema>;

export function applyPreferencePatch(current: PreferenceState, patch: PreferencePatch): PreferenceState {
  const merged = deepMerge(current, preferencePatchSchema.parse(patch));
  return preferenceStateSchema.parse({ ...merged, version: current.version + 1 });
}

function deepMerge<T>(target: T, patch: unknown): T {
  if (!isRecord(target) || !isRecord(patch)) return patch as T;
  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    result[key] = isRecord(value) && isRecord(result[key]) ? deepMerge(result[key], value) : value;
  }
  return result as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
