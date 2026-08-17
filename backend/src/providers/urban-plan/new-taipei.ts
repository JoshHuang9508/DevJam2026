import type { SourceMetadata } from "../../domain/candidates/schema.js";
import type { OverlayRecord, PlanCaseRecord, ZoningRecord } from "../../domain/urban-plan/schema.js";
import { createLimiter } from "../../lib/limit-concurrency.js";
import { fetchText, isTokenError, optionalPercent, optionalString, queryArcgisLayer, type ArcgisFeature } from "./arcgis.js";
import { dedupeOverlays, dedupeZones, message } from "./taipei.js";
import type { CityQuery, CityUrbanPlanSource, UrbanPlanContext, ZoneLookup } from "./types.js";

/**
 * 新北市城鄉資訊查詢平台 (城鄉發展局, NtpcURInfo).
 *
 * Its ArcGIS Server requires a token for the NTPC_Urban folder. The site hands that token to every
 * visitor from a plain script include, which is what we read here — the same access any browser
 * loading the public map page gets. The token rotates, so it is cached briefly and re-fetched once
 * whenever a query comes back with ArcGIS code 498/499.
 *
 * The 使用分區 layer is the richest of the three cities: 建蔽率 and 容積率 are on the polygon itself.
 * Field names are opaque (LZ1…LZ13); the mapping below was read off the site's own popup.
 */
const ARCGIS_ROOT = "https://arcgis.planning.ntpc.gov.tw/server/rest/services/NTPC_Urban";
const LANDUSE_SERVICE = `${ARCGIS_ROOT}/LandUse_WMS/MapServer`;
const LANDUSE_LAYER = 0; // NTPCUPGIS_SDE.dbo.LANDUSE
const TOKEN_URL = "https://urban.planning.ntpc.gov.tw/NtpcUrbArcgisToken/urban_planning_ntpc_gov_tw.js";
const REFERER = "https://urban.planning.ntpc.gov.tw";
const PUBLIC_SITE = "https://urban.planning.ntpc.gov.tw/NtpcURInfo/Map.aspx";
const TOKEN_TTL_MS = 5 * 60_000;

/** LZ3 用地類別, LZ4 分區簡稱, LZ6 建蔽率, LZ7 容積率, LZ13 建蔽/容積說明. */
const ZONING_FIELDS = "LZ3,LZ4,LZ6,LZ7,LZ13";
/** LZ8 所屬都市計畫, LZ1 細部計畫案名, LZ2 公告日期. */
const PLAN_FIELDS = "LZ1,LZ2,LZ8";

const OVERLAY_SERVICES: Array<{ service: string; layerId: number; name: string }> = [
  { service: "禁建線", layerId: 0, name: "禁建線（8 公尺範圍）" },
  { service: "禁建線", layerId: 1, name: "禁設廣告物範圍" },
  { service: "免建築線", layerId: 1, name: "免建築線範圍" },
  { service: "免建築線", layerId: 3, name: "經公告須辦理都市設計審議地區" },
];

export function createNewTaipeiSource(timeoutMs: number): CityUrbanPlanSource {
  let cachedToken: { value: string; expiresAt: number } | null = null;
  // Six endpoint hits per lookup on one host; see createLimiter for why they are not all fired at once.
  const limit = createLimiter(3);

  const token = async (query: CityQuery, forceRefresh = false): Promise<string> => {
    if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
    const script = await limit(() => fetchText(TOKEN_URL, { timeoutMs, signal: query.signal, referer: REFERER }));
    const parsed = /"([^"]+)"/.exec(script)?.[1];
    if (!parsed) throw new Error("新北市 ArcGIS token 取得失敗：回應格式不符預期");
    cachedToken = { value: parsed, expiresAt: Date.now() + TOKEN_TTL_MS };
    return parsed;
  };

  /** Runs an authenticated query, refreshing the shared token once if the server rejects it. */
  const authed = async (query: CityQuery, run: (value: string) => Promise<ArcgisFeature[]>): Promise<ArcgisFeature[]> => {
    try {
      return await run(await token(query));
    } catch (error: unknown) {
      if (!isTokenError(error)) throw error;
      return run(await token(query, true));
    }
  };

  const queryLayer = (query: CityQuery, service: string, layerId: number, outFields: string) =>
    authed(query, (value) => limit(() => queryArcgisLayer({
      serviceUrl: service,
      layerId,
      latitude: query.latitude,
      longitude: query.longitude,
      outFields,
      radiusM: query.radiusM,
      token: value,
      referer: REFERER,
      timeoutMs,
      signal: query.signal,
    })));

  return {
    city: "新北市",
    bounds: { minLatitude: 24.67, maxLatitude: 25.30, minLongitude: 121.20, maxLongitude: 122.02 },

    async fetchZones(query: CityQuery): Promise<ZoneLookup> {
      const features = await queryLayer(query, LANDUSE_SERVICE, LANDUSE_LAYER, ZONING_FIELDS);
      return { zones: dedupeZones(features.map(toZone)), warnings: [] };
    },

    async fetchContext(query: CityQuery): Promise<UrbanPlanContext> {
      const warnings: string[] = [];
      const [planFeatures, overlays] = await Promise.all([
        queryLayer(query, LANDUSE_SERVICE, LANDUSE_LAYER, PLAN_FIELDS).catch((error: unknown) => {
          warnings.push(`新北市都市計畫欄位讀取失敗：${message(error)}`);
          return [] as ArcgisFeature[];
        }),
        Promise.all(OVERLAY_SERVICES.map(async (overlay) => {
          try {
            const features = await queryLayer(query, `${ARCGIS_ROOT}/${encodeURIComponent(overlay.service)}/MapServer`, overlay.layerId, "*");
            return features.map((feature) => ({ name: overlay.name, detail: pickDetail(feature.attributes) }));
          } catch (error: unknown) {
            warnings.push(`新北市「${overlay.name}」圖層讀取失敗：${message(error)}`);
            return [] as OverlayRecord[];
          }
        })),
      ]);
      return {
        urbanPlanName: uniqueStrings(planFeatures.map((feature) => optionalString(feature.attributes.LZ8)))[0] ?? null,
        detailPlanNames: uniqueStrings(planFeatures.map((feature) => optionalString(feature.attributes.LZ1))),
        planCases: toPlanCases(planFeatures),
        overlays: dedupeOverlays(overlays.flat()),
        warnings,
      };
    },

    sourceMetadata(): SourceMetadata {
      return {
        provider: "ntpc-planning-landuse",
        sourceName: "新北市城鄉發展局 城鄉資訊查詢平台 使用分區圖資",
        sourceUrl: PUBLIC_SITE,
        fetchedAt: new Date().toISOString(),
        isFixture: false,
      };
    },
  };
}

function toZone(feature: ArcgisFeature): ZoningRecord {
  const attributes = feature.attributes;
  return {
    zoneName: optionalString(attributes.LZ3),
    // The dataset has no separate zone code column; 分區簡稱 (LZ4) is the only short form it carries.
    zoneCode: null,
    zoneShortName: optionalString(attributes.LZ4),
    buildingCoveragePct: optionalPercent(attributes.LZ6),
    floorAreaRatioPct: optionalPercent(attributes.LZ7),
    note: optionalString(attributes.LZ13),
  };
}

function toPlanCases(features: ArcgisFeature[]): PlanCaseRecord[] {
  const cases = new Map<string, PlanCaseRecord>();
  for (const feature of features) {
    const planName = optionalString(feature.attributes.LZ1);
    if (!planName || cases.has(planName)) continue;
    cases.set(planName, { planName, planNumber: null, publication: toDate(feature.attributes.LZ2), documents: [] });
  }
  return [...cases.values()];
}

/** LZ2 arrives as an epoch-milliseconds number (ArcGIS date field), not a formatted string. */
function toDate(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return optionalString(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** The overlay services expose no shared schema, so fall back to whatever descriptive field exists. */
function pickDetail(attributes: Record<string, unknown>): string | null {
  const hints = ["NAME", "DES", "MEMO", "NOTE", "TITLE"];
  for (const hint of hints) {
    for (const [key, value] of Object.entries(attributes)) {
      if (!key.toUpperCase().includes(hint)) continue;
      const text = optionalString(value);
      if (text) return text;
    }
  }
  return null;
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}
