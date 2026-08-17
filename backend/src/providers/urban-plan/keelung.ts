import type { SourceMetadata } from "../../domain/candidates/schema.js";
import type { OverlayRecord, PlanCaseRecord, ZoningRecord } from "../../domain/urban-plan/schema.js";
import { createLimiter } from "../../lib/limit-concurrency.js";
import { optionalString, queryArcgisLayer, type ArcgisFeature } from "./arcgis.js";
import { dedupeZones, message } from "./taipei.js";
import type { CityQuery, CityUrbanPlanSource, UrbanPlanContext, ZoneLookup } from "./types.js";

/**
 * 基隆市政府都市計畫整合查詢 (upgis.klcg.gov.tw/KL_LAND).
 *
 * All four layers we need sit in one public ArcGIS 10.31 service — no token, no proxy. Its latency
 * is the least predictable of the three: the same query measured 21 seconds repeatedly one afternoon
 * and 0.2–0.7 seconds later the same day, so this source gets its own longer timeout as headroom
 * rather than because it is always slow. The four layers are queried concurrently and the router
 * caches the result, which keeps a bad day survivable.
 *
 * The zoning layer has no 建蔽率/容積率 columns, so those stay null for 基隆 rather than being
 * inferred from the zone name.
 */
const SERVICE = "https://upgis.klcg.gov.tw/arcgiswa/rest/services/KL_UPGIS/kl_uplan/MapServer";
const ZONING_LAYER = 4; // 分區色塊圖
const MAIN_PLAN_LAYER = 5; // 主要計畫區
const DETAIL_PLAN_LAYER = 2; // 細部計畫區
const PLAN_CASE_LAYER = 7; // 都計案範圍
const PUBLIC_SITE = "https://upgis.klcg.gov.tw/KL_LAND/";

export function createKeelungSource(timeoutMs: number): CityUrbanPlanSource {
  // The slowest of the three servers, so the one that least tolerates a parallel burst.
  const limit = createLimiter(3);
  const queryLayer = (query: CityQuery, layerId: number, outFields: string) => limit(() => queryArcgisLayer({
    serviceUrl: SERVICE,
    layerId,
    latitude: query.latitude,
    longitude: query.longitude,
    outFields,
    radiusM: query.radiusM,
    timeoutMs,
    signal: query.signal,
  }));

  return {
    city: "基隆市",
    // Deliberately tight: 基隆 shares long borders with 新北市, and this box only decides who gets
    // asked first. Keeping 汐止 (~121.64) and 瑞芳 (~121.81) outside it avoids paying this server's
    // 20-second latency for coordinates that are really 新北市.
    bounds: { minLatitude: 25.08, maxLatitude: 25.22, minLongitude: 121.68, maxLongitude: 121.80 },

    async fetchZones(query: CityQuery): Promise<ZoneLookup> {
      const features = await queryLayer(query, ZONING_LAYER, "LUSE,LUSE_CODE,LUSE_DES,BLOCK_DEF");
      return { zones: dedupeZones(features.map(toZone)), warnings: [] };
    },

    async fetchContext(query: CityQuery): Promise<UrbanPlanContext> {
      const warnings: string[] = [];
      const safely = async <T>(label: string, run: () => Promise<ArcgisFeature[]>, map: (features: ArcgisFeature[]) => T, fallback: T): Promise<T> => {
        try {
          return map(await run());
        } catch (error: unknown) {
          warnings.push(`基隆市「${label}」圖層讀取失敗：${message(error)}`);
          return fallback;
        }
      };
      const [urbanPlanName, detailPlanNames, planCases] = await Promise.all([
        safely("主要計畫區", () => queryLayer(query, MAIN_PLAN_LAYER, "BLOCKNAME"),
          (features) => unique(features.map((feature) => optionalString(feature.attributes.BLOCKNAME)))[0] ?? null, null),
        safely("細部計畫區", () => queryLayer(query, DETAIL_PLAN_LAYER, "NAME"),
          (features) => unique(features.map((feature) => optionalString(feature.attributes.NAME))), []),
        safely("都計案範圍", () => queryLayer(query, PLAN_CASE_LAYER, "PLANNAME,PLANNO"),
          toPlanCases, []),
      ]);
      return { urbanPlanName, detailPlanNames, planCases, overlays: [] as OverlayRecord[], warnings };
    },

    sourceMetadata(): SourceMetadata {
      return {
        provider: "klcg-upgis-uplan",
        sourceName: "基隆市政府 都市計畫整合查詢系統 土地使用分區",
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
    zoneName: optionalString(attributes.LUSE),
    zoneCode: optionalString(attributes.LUSE_CODE),
    zoneShortName: optionalString(attributes.LUSE_DES),
    buildingCoveragePct: null,
    floorAreaRatioPct: null,
    note: optionalString(attributes.BLOCK_DEF),
  };
}

function toPlanCases(features: ArcgisFeature[]): PlanCaseRecord[] {
  const cases = new Map<string, PlanCaseRecord>();
  for (const feature of features) {
    const planName = optionalString(feature.attributes.PLANNAME);
    if (!planName) continue;
    const planNumber = optionalString(feature.attributes.PLANNO);
    const key = `${planName}|${planNumber ?? ""}`;
    if (!cases.has(key)) cases.set(key, { planName, planNumber, publication: null, documents: [] });
  }
  return [...cases.values()];
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}
