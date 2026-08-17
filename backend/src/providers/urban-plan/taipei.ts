import type { SourceMetadata } from "../../domain/candidates/schema.js";
import type { OverlayRecord, PlanCaseRecord, ZoningRecord } from "../../domain/urban-plan/schema.js";
import { createLimiter, type Limiter } from "../../lib/limit-concurrency.js";
import { fetchJson, isRecord, optionalPercent, optionalString, queryArcgisLayer, type ArcgisFeature } from "./arcgis.js";
import type { CityQuery, CityUrbanPlanSource, UrbanPlanContext, ZoneLookup } from "./types.js";

/**
 * 臺北市都市計畫土地使用分區查詢系統 (UPIS v2, 都市發展局).
 *
 * The public site at https://webgis.udd.gov.taipei/upis_v2 answers a coordinate click in two steps,
 * and this adapter reproduces exactly that:
 *   1. intersect the point with 歷年計畫案索引範圍圖 (PlanTheme layer 5) to collect PROJNUM values;
 *   2. POST that PROJNUM array to the UPIS web API, which returns the case names and 公告文號.
 * The zoning polygon itself lives in a separate service (UrbanPlan2 layer 2), which is the only one
 * carrying 分區代碼 / 使用分區 / 容積率 / 建蔽率.
 */
const GIS_ROOT = "https://www.historygis.udd.gov.taipei/arcgis/rest/services";
const ZONING_SERVICE = `${GIS_ROOT}/UrbanPlan2/UrbanPlan2/MapServer`;
const ZONING_LAYER = 2; // 都市計畫使用分區2(大比例尺)
const PLAN_THEME_SERVICE = `${GIS_ROOT}/UrbanPlan2/PlanTheme/MapServer`;
const PLAN_INDEX_LAYER = 5; // 歷年計畫案索引範圍圖
const UPIS_API = "https://webgis.udd.gov.taipei/upis_api/api/MainTable/ProjmapListByCoordinateCondition";
const REFERER = "https://webgis.udd.gov.taipei/upis_v2";
const PUBLIC_SITE = "https://webgis.udd.gov.taipei/upis_v2";

const ZONING_FIELDS = ["分區代碼", "分區簡稱", "使用分區", "分區說明", "容積率", "建蔽率"].join(",");

/** PlanTheme thematic layers. Each one the point falls into is a real constraint on building there. */
const OVERLAY_LAYERS: Array<{ layerId: number; name: string; outFields: string; detail: (attributes: Record<string, unknown>) => string | null }> = [
  { layerId: 0, name: "都市更新地區範圍", outFields: "PROJNUM,PLANDES,PLANDATE,PLANLEV", detail: (a) => optionalString(a.PLANDES) ?? optionalString(a.PLANLEV) },
  { layerId: 1, name: "軍事管制區禁限建範圍", outFields: "PROJNUM", detail: (a) => optionalString(a.PROJNUM) },
  { layerId: 2, name: "山坡地管制區", outFields: "PROJNUM", detail: (a) => optionalString(a.PROJNUM) },
  { layerId: 3, name: "都市設計審議地區範圍", outFields: "PROJNUM,PROJNUMD", detail: (a) => optionalString(a.PROJNUMD) ?? optionalString(a.PROJNUM) },
  // 免建築線指示地區 joins two tables, so its fields arrive fully qualified (UPIS_TP.DBO.…).
  // Asking for "*" is the only stable way to read it.
  { layerId: 4, name: "免建築線指示地區", outFields: "*", detail: (a) => firstQualified(a, ["UADES", "NAME"]) },
];

export function createTaipeiSource(timeoutMs: number): CityUrbanPlanSource {
  // One lookup touches eight endpoints on this host; unthrottled, they time each other out.
  const limit = createLimiter(3);
  return {
    city: "臺北市",
    bounds: { minLatitude: 24.95, maxLatitude: 25.22, minLongitude: 121.45, maxLongitude: 121.67 },

    async fetchZones(query: CityQuery): Promise<ZoneLookup> {
      const features = await limit(() => queryArcgisLayer({
        serviceUrl: ZONING_SERVICE,
        layerId: ZONING_LAYER,
        latitude: query.latitude,
        longitude: query.longitude,
        outFields: ZONING_FIELDS,
        radiusM: query.radiusM,
        referer: REFERER,
        timeoutMs,
        signal: query.signal,
      }));
      return { zones: dedupeZones(features.map(toZone)), warnings: [] };
    },

    async fetchContext(query: CityQuery): Promise<UrbanPlanContext> {
      const warnings: string[] = [];
      const [planCases, overlays] = await Promise.all([
        fetchPlanCases(query, timeoutMs, limit).catch((error: unknown) => {
          warnings.push(`臺北市都市計畫案清單讀取失敗：${message(error)}`);
          return [] as PlanCaseRecord[];
        }),
        fetchOverlays(query, timeoutMs, warnings, limit),
      ]);
      return {
        // 臺北市 does not stamp a single governing plan onto the zoning polygon; the case list below
        // is what the official site shows instead, so this stays null rather than guessing one.
        urbanPlanName: null,
        detailPlanNames: [],
        planCases,
        overlays,
        warnings,
      };
    },

    sourceMetadata(): SourceMetadata {
      return {
        provider: "taipei-udd-upis",
        sourceName: "臺北市都市發展局 都市計畫土地使用分區查詢系統 (UPIS v2)",
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
    zoneName: optionalString(attributes.使用分區),
    zoneCode: optionalString(attributes.分區代碼),
    zoneShortName: optionalString(attributes.分區簡稱),
    buildingCoveragePct: optionalPercent(attributes.建蔽率),
    floorAreaRatioPct: optionalPercent(attributes.容積率),
    note: optionalString(attributes.分區說明),
  };
}

async function fetchPlanCases(query: CityQuery, timeoutMs: number, limit: Limiter): Promise<PlanCaseRecord[]> {
  const indexFeatures = await limit(() => queryArcgisLayer({
    serviceUrl: PLAN_THEME_SERVICE,
    layerId: PLAN_INDEX_LAYER,
    latitude: query.latitude,
    longitude: query.longitude,
    outFields: "PROJNUM",
    radiusM: query.radiusM,
    referer: REFERER,
    timeoutMs,
    signal: query.signal,
  }));
  // One case covers many index polygons, so PROJNUM repeats heavily — a single point commonly
  // returns 60+ features for ~15 distinct cases.
  const projectNumbers = [...new Set(indexFeatures.map((feature) => optionalString(feature.attributes.PROJNUM)).filter((value): value is string => value !== null))];
  if (projectNumbers.length === 0) return [];

  const body = await limit(() => fetchJson(UPIS_API, { timeoutMs, signal: query.signal, referer: REFERER, jsonBody: projectNumbers }));
  if (!Array.isArray(body)) return [];
  return body.filter(isRecord).map((row) => ({
    planName: optionalString(row.projname) ?? optionalString(row.projnum) ?? "未命名都市計畫案",
    planNumber: optionalString(row.projnum),
    publication: optionalString(row.projpubl),
    documents: [
      row.projbookExist === true ? "計畫書" : null,
      row.projimgExist === true ? "計畫圖" : null,
      row.planextExist === true ? "計畫範圍圖" : null,
      row.btmprojExist === true ? "底圖" : null,
    ].filter((value): value is string => value !== null),
  }));
}

async function fetchOverlays(query: CityQuery, timeoutMs: number, warnings: string[], limit: Limiter): Promise<OverlayRecord[]> {
  const results = await Promise.all(OVERLAY_LAYERS.map(async (layer) => {
    try {
      const features = await limit(() => queryArcgisLayer({
        serviceUrl: PLAN_THEME_SERVICE,
        layerId: layer.layerId,
        latitude: query.latitude,
        longitude: query.longitude,
        outFields: layer.outFields,
        radiusM: query.radiusM,
        referer: REFERER,
        timeoutMs,
        signal: query.signal,
      }));
      return features.map((feature) => ({ name: layer.name, detail: layer.detail(feature.attributes) }));
    } catch (error: unknown) {
      warnings.push(`臺北市「${layer.name}」圖層讀取失敗：${message(error)}`);
      return [] as OverlayRecord[];
    }
  }));
  return dedupeOverlays(results.flat());
}

/** Reads a field whose name the service returns table-qualified, e.g. UPIS_TP.DBO.UAssignBUD.UADES. */
function firstQualified(attributes: Record<string, unknown>, suffixes: string[]): string | null {
  for (const suffix of suffixes) {
    for (const [key, value] of Object.entries(attributes)) {
      if (!key.toUpperCase().endsWith(suffix.toUpperCase())) continue;
      const text = optionalString(value);
      if (text) return text;
    }
  }
  return null;
}

export function dedupeZones(zones: ZoningRecord[]): ZoningRecord[] {
  const seen = new Map<string, ZoningRecord>();
  for (const zone of zones) {
    const key = [zone.zoneCode, zone.zoneName, zone.buildingCoveragePct, zone.floorAreaRatioPct].join("|");
    if (!seen.has(key)) seen.set(key, zone);
  }
  return [...seen.values()];
}

export function dedupeOverlays(overlays: OverlayRecord[]): OverlayRecord[] {
  const seen = new Map<string, OverlayRecord>();
  for (const overlay of overlays) {
    const key = `${overlay.name}|${overlay.detail ?? ""}`;
    if (!seen.has(key)) seen.set(key, overlay);
  }
  return [...seen.values()];
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
