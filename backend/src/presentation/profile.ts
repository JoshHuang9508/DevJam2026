import { z } from "zod";
import type { PreferencePatch, PreferenceState } from "../domain/preferences/schema.js";
import type { SearchProfile } from "../providers/listings/index.js";

const weightsSchema = z.object({
  price: z.number(), value: z.number(), weather: z.number(), location: z.number(),
  amenities: z.number(), space: z.number(), quality: z.number(), hazard: z.number(),
});

export const uiSearchProfileSchema = z.object({
  mode: z.enum(["sale", "rent"]),
  weights: weightsSchema,
  hard: z.record(z.string(), z.unknown()),
  soft: z.record(z.string(), z.unknown()).default({}),
  notes: z.array(z.string()).default([]),
});

export type UiSearchProfile = z.infer<typeof uiSearchProfileSchema>;

const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)));
const weight = (value: number) => Math.min(1, Math.max(0, Number((value / 100).toFixed(2))));

export function toPreferencePatch(profile: UiSearchProfile): PreferencePatch {
  const hard = profile.hard;
  const patch: PreferencePatch = {
    softPreferences: {
      housing: { weight: weight((profile.weights.price + profile.weights.value) / 2) },
      climate: { weight: weight(profile.weights.weather) },
      transportation: { weight: weight(profile.weights.location) },
      amenities: { weight: weight(profile.weights.amenities) },
    },
    listingPreferences: {
      hazardWeight: weight(profile.weights.hazard),
      priceWeight: weight(profile.weights.price),
      valueWeight: weight(profile.weights.value),
      spaceWeight: weight(profile.weights.space),
      qualityWeight: weight(profile.weights.quality),
    },
    hardConstraints: {
      mode: profile.mode,
      regions: strings(hard.regions) as Array<"北部" | "中部" | "南部" | "東部" | "離島">,
      cities: strings(hard.cities),
      districts: strings(hard.districts),
      excludedCities: strings(hard.excludedCities),
      excludedDistricts: strings(hard.excludedDistricts),
      ...(number(hard.minArea) !== undefined ? { minArea: number(hard.minArea) } : {}),
      ...(number(hard.minRooms) !== undefined ? { minRooms: number(hard.minRooms) } : {}),
      ...(number(hard.maxAge) !== undefined ? { maxAge: number(hard.maxAge) } : {}),
      ...(hard.needElevator === true ? { needElevator: true } : {}),
      ...(hard.needParking === true ? { needParking: true } : {}),
      ...(number(hard.maxCommuteMinutes) !== undefined ? { maxCommuteMinutes: Math.round(number(hard.maxCommuteMinutes)!) } : {}),
      ...(profile.mode === "sale" && number(hard.budgetMax) !== undefined ? { maxTotalPriceWan: Math.round(number(hard.budgetMax)!) } : {}),
      ...(profile.mode === "sale" && number(hard.budgetMin) !== undefined ? { minTotalPriceWan: Math.round(number(hard.budgetMin)!) } : {}),
      ...(profile.mode === "rent" && number(hard.budgetMax) !== undefined ? { maxMonthlyRent: Math.round(number(hard.budgetMax)!) } : {}),
      ...(profile.mode === "rent" && number(hard.budgetMin) !== undefined ? { minMonthlyRent: Math.round(number(hard.budgetMin)!) } : {}),
    },
  };
  return patch;
}

export function toUiSearchProfile(preferences: PreferenceState, base: UiSearchProfile): UiSearchProfile {
  const hard = preferences.hardConstraints;
  const listing = preferences.listingPreferences;
  const mode = hard.mode ?? base.mode;
  const nextHard: Record<string, unknown> = { ...base.hard };
  assignArray(nextHard, "regions", hard.regions);
  assignArray(nextHard, "cities", hard.cities);
  assignArray(nextHard, "districts", hard.districts);
  assignArray(nextHard, "excludedCities", hard.excludedCities);
  assignArray(nextHard, "excludedDistricts", hard.excludedDistricts);
  assign(nextHard, "minArea", hard.minArea);
  assign(nextHard, "minRooms", hard.minRooms);
  assign(nextHard, "maxAge", hard.maxAge);
  assign(nextHard, "needElevator", hard.needElevator === true ? true : undefined);
  assign(nextHard, "needParking", hard.needParking === true ? true : undefined);
  assign(nextHard, "maxCommuteMinutes", hard.maxCommuteMinutes);
  assign(nextHard, "budgetMin", mode === "sale" ? hard.minTotalPriceWan : hard.minMonthlyRent);
  assign(nextHard, "budgetMax", mode === "sale" ? hard.maxTotalPriceWan : hard.maxMonthlyRent);
  const housing = preferences.softPreferences.housing.weight * 100;
  const shift = housing - ((base.weights.price + base.weights.value) / 2);
  return {
    mode,
    weights: {
      price: listing.priceWeight === undefined ? clamp(base.weights.price + shift) : clamp(listing.priceWeight * 100),
      value: listing.valueWeight === undefined ? clamp(base.weights.value + shift) : clamp(listing.valueWeight * 100),
      weather: clamp(preferences.softPreferences.climate.weight * 100),
      location: clamp(preferences.softPreferences.transportation.weight * 100),
      amenities: clamp(preferences.softPreferences.amenities.weight * 100),
      space: listing.spaceWeight === undefined ? base.weights.space : clamp(listing.spaceWeight * 100),
      quality: listing.qualityWeight === undefined ? base.weights.quality : clamp(listing.qualityWeight * 100),
      hazard: clamp(listing.hazardWeight * 100),
    },
    hard: nextHard,
    soft: {
      ...base.soft,
      prefersLowRain: preferences.softPreferences.climate.rainfall.preference === "low",
      prefersCool: (preferences.softPreferences.climate.temperature.preferredMax ?? 99) <= 26,
    },
    notes: base.notes,
  };
}

export function asProviderProfile(profile: UiSearchProfile): SearchProfile {
  return profile;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function assign(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

function assignArray(target: Record<string, unknown>, key: string, value: string[] | undefined): void {
  if (value?.length) target[key] = value;
  else delete target[key];
}
