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
  maxCommuteMinutes: z.number().int().positive().max(240).optional(),
});
const hardConstraintsSchema = hardConstraintsSchemaBase.superRefine((value, ctx) => {
  if (value.minMonthlyRent !== undefined && value.maxMonthlyRent !== undefined && value.minMonthlyRent > value.maxMonthlyRent) {
    ctx.addIssue({ code: "custom", message: "minMonthlyRent cannot exceed maxMonthlyRent" });
  }
});

export const preferenceStateSchema = z.object({
  version: z.number().int().positive().default(1),
  hardConstraints: hardConstraintsSchema,
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
  softPreferences: preferenceStateSchema.shape.softPreferences.partial().extend({
    housing: preferenceStateSchema.shape.softPreferences.shape.housing.partial().optional(),
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
