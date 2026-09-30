import { z } from 'zod'
import { DEFAULT_PROFILE, REGIONS, normalizeCity, type SearchProfile } from '@/lib/types/profile'

const nonNegative = z.number().finite().transform((value) => Math.max(0, value))
const normalize = (values: string[] | undefined) => values?.map(normalizeCity)

export const searchProfileSchema = z.object({
  mode: z.enum(['sale', 'rent']),
  hard: z.object({
    regions: z.array(z.enum(REGIONS)).max(5).optional(),
    cities: z.array(z.string().min(1)).max(22).optional().transform(normalize),
    districts: z.array(z.string().min(1)).max(30).optional().transform(normalize),
    excludedCities: z.array(z.string().min(1)).max(22).optional().transform(normalize),
    excludedDistricts: z.array(z.string().min(1)).max(30).optional().transform(normalize),
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
  }).optional().transform((hard) => hard ?? {}),
  notes: z.array(z.string()).max(10).optional().transform((notes) => notes ?? []),
})

export function parseProfile(input: unknown): SearchProfile {
  const parsed = searchProfileSchema.safeParse(input)
  return parsed.success ? parsed.data : structuredClone(DEFAULT_PROFILE)
}
