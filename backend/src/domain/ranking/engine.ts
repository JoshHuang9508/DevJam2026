import type { Candidate } from "../candidates/schema.js";
import type { PreferenceState } from "../preferences/schema.js";

type Dimension = keyof Candidate["normalizedScores"];
const dimensions: Dimension[] = ["climate", "housing", "transportation", "amenities", "geography"];

export interface RankingResult {
  ranked: Candidate[];
  excluded: Array<{ id: string; reason: string }>;
}

export function rankCandidates(candidates: Candidate[], preferences: PreferenceState): RankingResult {
  const excluded: RankingResult["excluded"] = [];
  const eligible = candidates.filter((candidate) => {
    const rent = candidate.rawData.housing?.medianMonthlyRent;
    const hard = preferences.hardConstraints;
    if (hard.maxMonthlyRent !== undefined && rent !== undefined && rent > hard.maxMonthlyRent) {
      excluded.push({ id: candidate.id, reason: `median rent ${rent} exceeds hard maximum ${hard.maxMonthlyRent}` });
      return false;
    }
    if (hard.minMonthlyRent !== undefined && rent !== undefined && rent < hard.minMonthlyRent) {
      excluded.push({ id: candidate.id, reason: `median rent ${rent} is below hard minimum ${hard.minMonthlyRent}` });
      return false;
    }
    return true;
  });

  const extents = buildExtents(eligible);
  const scored = eligible.map((candidate) => scoreCandidate(candidate, preferences, extents));
  scored.sort((a, b) => b.score - a.score || b.confidence - a.confidence || (a.rawData.housing?.medianMonthlyRent ?? Infinity) - (b.rawData.housing?.medianMonthlyRent ?? Infinity) || a.id.localeCompare(b.id));
  return { ranked: scored, excluded };
}

function scoreCandidate(candidate: Candidate, preferences: PreferenceState, extents: Extents): Candidate {
  const scores: Candidate["normalizedScores"] = {
    housing: housingScore(candidate, extents),
    climate: climateScore(candidate, preferences, extents),
    transportation: transportScore(candidate, preferences, extents),
    amenities: amenityScore(candidate, preferences, extents),
    geography: geographyScore(candidate, preferences, extents),
  };
  const requestedWeights: Record<Dimension, number> = {
    housing: preferences.softPreferences.housing.weight,
    climate: preferences.softPreferences.climate.weight,
    transportation: preferences.softPreferences.transportation.weight,
    amenities: preferences.softPreferences.amenities.weight,
    geography: preferences.softPreferences.geography.weight,
  };
  const availableWeight = dimensions.reduce((sum, key) => sum + (scores[key] === null ? 0 : requestedWeights[key]), 0);
  const availableCount = dimensions.filter((key) => scores[key] !== null).length;
  const breakdown = {} as Candidate["scoreBreakdown"];
  let finalScore = 0;
  for (const key of dimensions) {
    const rawScore = scores[key];
    const effectiveWeight = rawScore === null || availableWeight === 0 ? 0 : requestedWeights[key] / availableWeight;
    const contribution = rawScore === null ? 0 : rawScore * effectiveWeight;
    finalScore += contribution;
    breakdown[key] = {
      rawScore,
      weight: requestedWeights[key],
      effectiveWeight,
      contribution: round(contribution),
      available: rawScore !== null,
      reason: rawScore === null ? "data unavailable; weight redistributed" : `${key} normalized deterministic score`,
    };
  }
  const highlights = topDimensions(scores, true).map((key) => `${label(key)}表現較佳（${round(scores[key] ?? 0)}）`);
  const tradeoffs = topDimensions(scores, false).map((key) => `${label(key)}相對弱（${round(scores[key] ?? 0)}）`);
  return { ...candidate, normalizedScores: scores, score: round(finalScore), confidence: round(availableCount / dimensions.length, 2), scoreBreakdown: breakdown, highlights, tradeoffs };
}

function housingScore(candidate: Candidate, extents: Extents): number | null {
  const rent = candidate.rawData.housing?.medianMonthlyRent;
  return rent === undefined ? null : inverseNormalize(rent, extents.rent);
}

function climateScore(candidate: Candidate, preferences: PreferenceState, extents: Extents): number | null {
  const data = candidate.rawData.climate;
  if (!data) return null;
  const pref = preferences.softPreferences.climate;
  const rainfallBase = inverseNormalize(data.annualRainyDays, extents.rainyDays);
  const rainfallScore = pref.rainfall.preference === "low" ? rainfallBase : pref.rainfall.preference === "high" ? 100 - rainfallBase : 100 - Math.abs(rainfallBase - 50) * 2;
  const humidityTarget = pref.humidity.preference === "low" ? 60 : pref.humidity.preference === "high" ? 82 : 72;
  const humidityScore = clamp(100 - Math.abs(data.relativeHumidityPct - humidityTarget) * 6);
  const min = pref.temperature.preferredMin ?? 18;
  const max = pref.temperature.preferredMax ?? 28;
  const tempScore = data.averageTemperatureC < min ? clamp(100 - (min - data.averageTemperatureC) * 12) : data.averageTemperatureC > max ? clamp(100 - (data.averageTemperatureC - max) * 12) : 100;
  return weightedAverage([
    [tempScore, pref.temperature.weight],
    [rainfallScore, pref.rainfall.weight],
    [humidityScore, pref.humidity.weight],
  ]);
}

function transportScore(candidate: Candidate, preferences: PreferenceState, extents: Extents): number | null {
  const data = candidate.rawData.transportation;
  if (!data) return null;
  const pref = preferences.softPreferences.transportation;
  return weightedAverage([
    [distanceScore(data.railwayDistanceKm), pref.railwayAccess],
    [distanceScore(data.highSpeedRailDistanceKm), pref.highSpeedRailAccess],
    [distanceScore(data.mrtDistanceKm), pref.mrtAccess],
    [normalize(data.busStopsPerKm2, extents.busStops), pref.busAccess],
  ].filter(([score]) => score !== null) as Array<[number, number]>);
}

function amenityScore(candidate: Candidate, preferences: PreferenceState, extents: Extents): number | null {
  const data = candidate.rawData.amenities;
  if (!data) return null;
  const pref = preferences.softPreferences.amenities;
  return weightedAverage([
    [normalize(data.convenienceStoresPerKm2, extents.convenience), pref.convenienceStore],
    [normalize(data.supermarketsPerKm2, extents.supermarkets), pref.supermarket],
    [normalize(data.hospitalsPer100k, extents.hospitals), pref.hospital],
    [normalize(data.clinicsPer100k, extents.clinics), pref.clinic],
    [normalize(data.restaurantsPerKm2, extents.restaurants), pref.restaurant],
    [normalize(data.schoolsPerKm2, extents.schools), pref.school],
    [normalize(data.parksPerKm2, extents.parks), pref.park],
  ]);
}

function geographyScore(candidate: Candidate, preferences: PreferenceState, extents: Extents): number | null {
  const data = candidate.rawData.geography;
  if (!data) return null;
  const pref = preferences.softPreferences.geography;
  const coastal = pref.coastalPreference === 0 ? 50 : pref.coastalPreference > 0 ? inverseNormalize(data.coastalDistanceKm, extents.coastal) : normalize(data.coastalDistanceKm, extents.coastal);
  return weightedAverage([
    [normalize(data.populationDensityPerKm2, extents.density), pref.urbanDensity],
    [normalize(data.elevationM, extents.elevation), pref.elevation],
    [coastal, Math.abs(pref.coastalPreference)],
  ]);
}

interface Range { min: number; max: number }
interface Extents { rent: Range; rainyDays: Range; busStops: Range; convenience: Range; supermarkets: Range; hospitals: Range; clinics: Range; restaurants: Range; schools: Range; parks: Range; coastal: Range; density: Range; elevation: Range }

function buildExtents(candidates: Candidate[]): Extents {
  return {
    rent: range(candidates.map((c) => c.rawData.housing?.medianMonthlyRent)),
    rainyDays: range(candidates.map((c) => c.rawData.climate?.annualRainyDays)),
    busStops: range(candidates.map((c) => c.rawData.transportation?.busStopsPerKm2)),
    convenience: range(candidates.map((c) => c.rawData.amenities?.convenienceStoresPerKm2)),
    supermarkets: range(candidates.map((c) => c.rawData.amenities?.supermarketsPerKm2)),
    hospitals: range(candidates.map((c) => c.rawData.amenities?.hospitalsPer100k)),
    clinics: range(candidates.map((c) => c.rawData.amenities?.clinicsPer100k)),
    restaurants: range(candidates.map((c) => c.rawData.amenities?.restaurantsPerKm2)),
    schools: range(candidates.map((c) => c.rawData.amenities?.schoolsPerKm2)),
    parks: range(candidates.map((c) => c.rawData.amenities?.parksPerKm2)),
    coastal: range(candidates.map((c) => c.rawData.geography?.coastalDistanceKm)),
    density: range(candidates.map((c) => c.rawData.geography?.populationDensityPerKm2)),
    elevation: range(candidates.map((c) => c.rawData.geography?.elevationM)),
  };
}

function range(values: Array<number | undefined>): Range {
  const valid = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return { min: valid.length ? Math.min(...valid) : 0, max: valid.length ? Math.max(...valid) : 1 };
}
function normalize(value: number, bounds: Range): number { return bounds.max === bounds.min ? 100 : clamp(((value - bounds.min) / (bounds.max - bounds.min)) * 100); }
function inverseNormalize(value: number, bounds: Range): number { return 100 - normalize(value, bounds); }
function distanceScore(value: number | null): number | null { return value === null ? null : clamp(100 * Math.exp(-value / 4)); }
function weightedAverage(entries: Array<[number, number]>): number { const total = entries.reduce((s, [, w]) => s + w, 0); return total === 0 ? 50 : entries.reduce((s, [v, w]) => s + v * w, 0) / total; }
function clamp(value: number): number { return Math.min(100, Math.max(0, value)); }
function round(value: number, digits = 1): number { const factor = 10 ** digits; return Math.round(value * factor) / factor; }
function topDimensions(scores: Candidate["normalizedScores"], best: boolean): Dimension[] { return dimensions.filter((key) => scores[key] !== null).sort((a, b) => best ? (scores[b] ?? 0) - (scores[a] ?? 0) : (scores[a] ?? 0) - (scores[b] ?? 0)).slice(0, 2); }
function label(key: Dimension): string { return ({ housing: "租金", climate: "氣候", transportation: "交通", amenities: "生活機能", geography: "地理" } as const)[key]; }

