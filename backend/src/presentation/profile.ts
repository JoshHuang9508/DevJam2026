import { z } from "zod";
import type { PreferencePatch, PreferenceState } from "../domain/preferences/schema.js";
import type { SearchProfile } from "../providers/listings/index.js";

export const uiSearchProfileSchema = z.object({
  mode: z.enum(["sale", "rent"]),
  hard: z.record(z.string(), z.unknown()),
  notes: z.array(z.string()).default([]),
});

export type UiSearchProfile = z.infer<typeof uiSearchProfileSchema>;

export function toPreferencePatch(profile: UiSearchProfile): PreferencePatch {
  const hard = profile.hard;
  return {
    hardConstraints: {
      mode: profile.mode,
      regions: strings(hard.regions) as Array<"北部" | "中部" | "南部" | "東部" | "離島">,
      cities: strings(hard.cities),
      districts: strings(hard.districts),
      excludedCities: strings(hard.excludedCities),
      excludedDistricts: strings(hard.excludedDistricts),
      buildingTypes: strings(hard.buildingTypes) as Array<"大樓" | "華廈" | "公寓" | "透天">,
      ...(number(hard.minArea) !== undefined ? { minArea: number(hard.minArea) } : {}),
      ...(number(hard.minRooms) !== undefined ? { minRooms: number(hard.minRooms) } : {}),
      ...(number(hard.maxAge) !== undefined ? { maxAge: number(hard.maxAge) } : {}),
      ...(hard.needElevator === true ? { needElevator: true } : {}),
      ...(hard.needParking === true ? { needParking: true } : {}),
      ...(number(hard.maxCommuteMinutes) !== undefined ? { maxCommuteMinutes: Math.round(number(hard.maxCommuteMinutes)!) } : {}),
      ...(number(hard.maxDistToMetro) !== undefined ? { maxWalkMinutesToMetro: Math.max(1, Math.round(number(hard.maxDistToMetro)! / 80)) } : {}),
      ...(profile.mode === "sale" && number(hard.budgetMax) !== undefined ? { maxTotalPriceWan: Math.round(number(hard.budgetMax)!) } : {}),
      ...(profile.mode === "sale" && number(hard.budgetMin) !== undefined ? { minTotalPriceWan: Math.round(number(hard.budgetMin)!) } : {}),
      ...(profile.mode === "rent" && number(hard.budgetMax) !== undefined ? { maxMonthlyRent: Math.round(number(hard.budgetMax)!) } : {}),
      ...(profile.mode === "rent" && number(hard.budgetMin) !== undefined ? { minMonthlyRent: Math.round(number(hard.budgetMin)!) } : {}),
    },
  };
}

export function toUiSearchProfile(preferences: PreferenceState, base: UiSearchProfile): UiSearchProfile {
  const hard = preferences.hardConstraints;
  const mode = hard.mode ?? base.mode;
  const nextHard: Record<string, unknown> = { ...base.hard };
  assignArray(nextHard, "regions", hard.regions);
  assignArray(nextHard, "cities", hard.cities);
  assignArray(nextHard, "districts", hard.districts);
  assignArray(nextHard, "excludedCities", hard.excludedCities);
  assignArray(nextHard, "excludedDistricts", hard.excludedDistricts);
  assignArray(nextHard, "buildingTypes", hard.buildingTypes);
  assign(nextHard, "minArea", hard.minArea);
  assign(nextHard, "minRooms", hard.minRooms);
  assign(nextHard, "maxAge", hard.maxAge);
  assign(nextHard, "needElevator", hard.needElevator === true ? true : undefined);
  assign(nextHard, "needParking", hard.needParking === true ? true : undefined);
  assign(nextHard, "maxCommuteMinutes", hard.maxCommuteMinutes);
  assign(nextHard, "maxDistToMetro", hard.maxWalkMinutesToMetro === undefined ? undefined : hard.maxWalkMinutesToMetro * 80);
  assign(nextHard, "budgetMin", mode === "sale" ? hard.minTotalPriceWan : hard.minMonthlyRent);
  assign(nextHard, "budgetMax", mode === "sale" ? hard.maxTotalPriceWan : hard.maxMonthlyRent);
  return { mode, hard: nextHard, notes: base.notes };
}

export function asProviderProfile(profile: UiSearchProfile): SearchProfile {
  return profile;
}

function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function number(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function assign(target: Record<string, unknown>, key: string, value: unknown): void { if (value === undefined) delete target[key]; else target[key] = value; }
function assignArray(target: Record<string, unknown>, key: string, value: string[] | undefined): void { if (value?.length) target[key] = value; else delete target[key]; }
