import type { UrbanPlanCity, UrbanPlanReport } from "../../domain/urban-plan/schema.js";
import { createKeelungSource } from "./keelung.js";
import { createNewTaipeiSource } from "./new-taipei.js";
import { createTaipeiSource, message } from "./taipei.js";
import { emptyContext, type CityUrbanPlanSource, type UrbanPlanContext, type UrbanPlanLookupInput, type UrbanPlanProvider, type ZoneLookup } from "./types.js";

/**
 * Routes a coordinate to 臺北市 / 新北市 / 基隆市 and returns one normalised urban-planning report.
 *
 * Resolution order matters. A point that misses every zoning polygon in the first city must not be
 * answered from a widened search there before the other candidate cities have been tried at close
 * range — otherwise a coordinate in 永和 could be answered with 臺北市 polygons from across the
 * 新店溪. So the search runs city by city at parcel range first, then at block range, and only
 * widens further once nothing has been found anywhere nearby.
 */

/** Roughly one street block: enough to escape a road or river gap in the zoning polygons. */
const NEARBY_RADIUS_M = 45;
/** Last resort, only after every candidate city missed at NEARBY_RADIUS_M. Always reported as nearby. */
const WIDE_RADIUS_M = 220;

/** Thrown when the coordinate is outside every adapter's city, i.e. a caller error rather than a fault. */
export class UrbanPlanCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrbanPlanCoverageError";
  }
}

export interface UrbanPlanProviderOptions {
  /** 臺北市 / 新北市 answer a full lookup in ~1s; this is a ceiling, not a target. */
  timeoutMs?: number;
  /** 基隆市's ArcGIS 10.31 server has been seen taking 21s for a query it usually serves in 0.2s. */
  slowTimeoutMs?: number;
  /** Zoning changes on the scale of years, so a long TTL is safe and absorbs a slow upstream day. */
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  /** Injectable for tests; defaults to the three live adapters. */
  sources?: CityUrbanPlanSource[];
}

export function createUrbanPlanProvider(options: UrbanPlanProviderOptions = {}): UrbanPlanProvider {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const slowTimeoutMs = options.slowTimeoutMs ?? 45_000;
  const cacheTtlMs = options.cacheTtlMs ?? 24 * 60 * 60_000;
  const cacheMaxEntries = options.cacheMaxEntries ?? 500;
  const sources = options.sources ?? [
    createKeelungSource(slowTimeoutMs),
    createTaipeiSource(timeoutMs),
    createNewTaipeiSource(timeoutMs),
  ];
  const cache = new Map<string, { expiresAt: number; report: UrbanPlanReport }>();

  return {
    async lookup(input: UrbanPlanLookupInput, signal?: AbortSignal): Promise<UrbanPlanReport> {
      const { latitude, longitude } = input;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error("latitude 與 longitude 必須是有效數字（WGS84 十進位度）");
      const candidates = resolveCandidates(sources, input);
      if (candidates.length === 0) {
        throw new UrbanPlanCoverageError(`座標 ${latitude}, ${longitude} 不在已接入的都市計畫圖資範圍內。目前只涵蓋 ${sources.map((source) => source.city).join("、")}。`);
      }

      const key = `${input.city ?? "auto"}:${latitude.toFixed(5)}:${longitude.toFixed(5)}`;
      const cached = cache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.report;

      const report = await search(candidates, input, signal);
      cache.set(key, { expiresAt: Date.now() + cacheTtlMs, report });
      if (cache.size > cacheMaxEntries) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      return report;
    },
  };
}

interface CityAttempt {
  source: CityUrbanPlanSource;
  parcel: ZoneLookup;
  nearby: ZoneLookup;
  /** Only pre-fetched for the first candidate, where it is usually the one that answers. */
  context: UrbanPlanContext | null;
  warnings: string[];
}

async function search(candidates: CityUrbanPlanSource[], input: UrbanPlanLookupInput, signal?: AbortSignal): Promise<UrbanPlanReport> {
  const attempts: CityAttempt[] = [];
  for (const [index, source] of candidates.entries()) {
    const attempt = await probe(source, input, signal, index === 0);
    attempts.push(attempt);
    // A parcel hit is authoritative for this coordinate — no reason to ask the remaining cities.
    if (attempt.parcel.zones.length > 0) return build(attempt, attempt.parcel.zones, 0, input, signal);
  }
  const nearbyHit = attempts.find((attempt) => attempt.nearby.zones.length > 0);
  if (nearbyHit) return build(nearbyHit, nearbyHit.nearby.zones, NEARBY_RADIUS_M, input, signal);

  const [first] = attempts;
  if (!first) throw new UrbanPlanCoverageError("沒有任何城市圖資可查詢此座標");
  const wide = await first.source.fetchZones({ latitude: input.latitude, longitude: input.longitude, radiusM: WIDE_RADIUS_M, signal })
    .catch((error: unknown) => {
      first.warnings.push(`${first.source.city} 使用分區圖層讀取失敗：${message(error)}`);
      return { zones: [], warnings: [] } satisfies ZoneLookup;
    });
  return wide.zones.length > 0
    ? build(first, wide.zones, WIDE_RADIUS_M, input, signal)
    : build(first, [], null, input, signal);
}

async function probe(source: CityUrbanPlanSource, input: UrbanPlanLookupInput, signal: AbortSignal | undefined, prefetchContext: boolean): Promise<CityAttempt> {
  const warnings: string[] = [];
  const base = { latitude: input.latitude, longitude: input.longitude, signal };
  const zones = (radiusM: number) => source.fetchZones({ ...base, radiusM }).catch((error: unknown) => {
    warnings.push(`${source.city} 使用分區圖層讀取失敗（半徑 ${radiusM} 公尺）：${message(error)}`);
    return { zones: [], warnings: [] } satisfies ZoneLookup;
  });
  const [parcel, nearby, context] = await Promise.all([
    zones(0),
    zones(NEARBY_RADIUS_M),
    prefetchContext
      ? source.fetchContext({ ...base, radiusM: 0 }).catch((error: unknown) => {
        warnings.push(`${source.city} 都市計畫資訊讀取失敗：${message(error)}`);
        return emptyContext();
      })
      : Promise.resolve(null),
  ]);
  return { source, parcel, nearby, context, warnings };
}

async function build(
  attempt: CityAttempt,
  zones: UrbanPlanReport["zones"],
  radiusM: number | null,
  input: UrbanPlanLookupInput,
  signal?: AbortSignal,
): Promise<UrbanPlanReport> {
  const base = { latitude: input.latitude, longitude: input.longitude, signal };
  const warnings = [...attempt.warnings];
  const contextRadius = radiusM ?? NEARBY_RADIUS_M;
  let context = attempt.context;
  // The pre-fetch runs at parcel range; widen it too when that came back with nothing to say.
  if (context === null || (contextRadius > 0 && isBlank(context))) {
    context = await attempt.source.fetchContext({ ...base, radiusM: contextRadius }).catch((error: unknown) => {
      warnings.push(`${attempt.source.city} 都市計畫資訊讀取失敗：${message(error)}`);
      return emptyContext();
    });
  }
  warnings.push(...context.warnings, ...attempt.parcel.warnings, ...attempt.nearby.warnings);

  const match = zones.length === 0 ? "none" : radiusM === 0 ? "parcel" : "nearby";
  if (match === "nearby") {
    warnings.push(`座標未落在任何使用分區圖形內（道路、河川、公共設施用地常無分區圖形），改以半徑 ${radiusM} 公尺內的分區作為參考，不等同該地號的法定分區。`);
  }
  if (match === "none") {
    warnings.push(`${attempt.source.city} 圖資在此座標查無使用分區資料，可能位於非都市計畫區或圖資未涵蓋範圍。`);
  }

  return {
    city: attempt.source.city,
    coordinate: { latitude: input.latitude, longitude: input.longitude },
    match,
    searchRadiusM: zones.length === 0 ? null : radiusM,
    zones,
    urbanPlanName: context.urbanPlanName,
    detailPlanNames: context.detailPlanNames,
    planCases: context.planCases,
    overlays: context.overlays,
    quality: zones.length === 0 ? "missing" : "observed",
    sources: [attempt.source.sourceMetadata()],
    warnings: [...new Set(warnings)],
  };
}

function isBlank(context: UrbanPlanContext): boolean {
  return context.urbanPlanName === null && context.detailPlanNames.length === 0 && context.planCases.length === 0 && context.overlays.length === 0;
}

/**
 * Candidate cities for a coordinate, tightest bounding box first. The boxes only decide who gets
 * asked — the answer always comes from whichever city's polygons actually contain the point.
 */
function resolveCandidates(sources: CityUrbanPlanSource[], input: UrbanPlanLookupInput): CityUrbanPlanSource[] {
  if (input.city) return sources.filter((source) => source.city === input.city);
  return sources
    .filter((source) => contains(source, input.latitude, input.longitude))
    .sort((left, right) => area(left) - area(right));
}

function contains(source: CityUrbanPlanSource, latitude: number, longitude: number): boolean {
  const { minLatitude, maxLatitude, minLongitude, maxLongitude } = source.bounds;
  return latitude >= minLatitude && latitude <= maxLatitude && longitude >= minLongitude && longitude <= maxLongitude;
}

function area(source: CityUrbanPlanSource): number {
  const { minLatitude, maxLatitude, minLongitude, maxLongitude } = source.bounds;
  return (maxLatitude - minLatitude) * (maxLongitude - minLongitude);
}

export type { UrbanPlanCity, UrbanPlanProvider };
