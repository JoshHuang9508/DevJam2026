import { z } from "zod";

export const sourceMetadataSchema = z.object({
  provider: z.string(),
  sourceName: z.string(),
  sourceUrl: z.string().url().optional(),
  fetchedAt: z.string().datetime(),
  isFixture: z.boolean(),
});

export const dataQualitySchema = z.enum(["observed", "estimated", "fixture", "missing"]);

export const locationBaseSchema = z.object({
  id: z.string(),
  region: z.enum(["北部", "中部", "南部", "東部", "離島"]),
  city: z.string(),
  district: z.string(),
  latitude: z.number().min(20).max(27),
  longitude: z.number().min(118).max(123),
});

export const climateStatsSchema = z.object({
  averageTemperatureC: z.number(),
  summerHighC: z.number(),
  winterLowC: z.number(),
  annualRainfallMm: z.number().nonnegative(),
  annualRainyDays: z.number().nonnegative(),
  relativeHumidityPct: z.number().min(0).max(100),
});

export const housingStatsSchema = z.object({
  medianMonthlyRent: z.number().nonnegative(),
  averageMonthlyRent: z.number().nonnegative(),
  sampleSize: z.number().int().nonnegative(),
  currency: z.literal("TWD"),
});

export const amenityStatsSchema = z.object({
  convenienceStoresPerKm2: z.number().nonnegative(),
  supermarketsPerKm2: z.number().nonnegative(),
  hospitalsPer100k: z.number().nonnegative(),
  clinicsPer100k: z.number().nonnegative(),
  restaurantsPerKm2: z.number().nonnegative(),
  schoolsPerKm2: z.number().nonnegative(),
  parksPerKm2: z.number().nonnegative(),
});

export const transportStatsSchema = z.object({
  railwayDistanceKm: z.number().nonnegative().nullable(),
  highSpeedRailDistanceKm: z.number().nonnegative().nullable(),
  mrtDistanceKm: z.number().nonnegative().nullable(),
  busStopsPerKm2: z.number().nonnegative(),
});

export const geographyStatsSchema = z.object({
  elevationM: z.number(),
  coastalDistanceKm: z.number().nonnegative(),
  populationDensityPerKm2: z.number().nonnegative(),
});

const scoreBreakdownItemSchema = z.object({
  rawScore: z.number().min(0).max(100).nullable(),
  weight: z.number().min(0).max(1),
  effectiveWeight: z.number().min(0).max(1),
  contribution: z.number().min(0).max(100),
  available: z.boolean(),
  reason: z.string(),
});

export const candidateSchema = locationBaseSchema.extend({
  rawData: z.object({
    climate: climateStatsSchema.nullable(),
    housing: housingStatsSchema.nullable(),
    transportation: transportStatsSchema.nullable(),
    amenities: amenityStatsSchema.nullable(),
    geography: geographyStatsSchema.nullable(),
  }),
  sources: z.record(z.string(), sourceMetadataSchema.nullable()),
  dataQuality: z.record(z.string(), dataQualitySchema),
  normalizedScores: z.object({
    climate: z.number().min(0).max(100).nullable(),
    housing: z.number().min(0).max(100).nullable(),
    transportation: z.number().min(0).max(100).nullable(),
    amenities: z.number().min(0).max(100).nullable(),
    geography: z.number().min(0).max(100).nullable(),
  }),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  scoreBreakdown: z.object({
    climate: scoreBreakdownItemSchema,
    housing: scoreBreakdownItemSchema,
    transportation: scoreBreakdownItemSchema,
    amenities: scoreBreakdownItemSchema,
    geography: scoreBreakdownItemSchema,
  }),
  highlights: z.array(z.string()),
  tradeoffs: z.array(z.string()),
});

export type LocationBase = z.infer<typeof locationBaseSchema>;
export type ClimateStats = z.infer<typeof climateStatsSchema>;
export type HousingStats = z.infer<typeof housingStatsSchema>;
export type AmenityStats = z.infer<typeof amenityStatsSchema>;
export type TransportStats = z.infer<typeof transportStatsSchema>;
export type GeographyStats = z.infer<typeof geographyStatsSchema>;
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type DataQuality = z.infer<typeof dataQualitySchema>;

