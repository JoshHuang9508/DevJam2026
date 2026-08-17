import { afterEach, describe, expect, it, vi } from "vitest";
import { createDomainTools } from "../src/agent/tools/domain-tools.js";
import { urbanPlanReportSchema, type UrbanPlanCity, type ZoningRecord } from "../src/domain/urban-plan/schema.js";
import { ArcgisError, isTokenError, optionalPercent, optionalString, queryArcgisLayer } from "../src/providers/urban-plan/arcgis.js";
import { createUrbanPlanProvider, UrbanPlanCoverageError } from "../src/providers/urban-plan/index.js";
import { emptyContext, type CityBounds, type CityQuery, type CityUrbanPlanSource } from "../src/providers/urban-plan/types.js";

const TAIPEI_STATION = { latitude: 25.0478, longitude: 121.5637 };
const YONGHE = { latitude: 25.0079, longitude: 121.515 };

const zone = (zoneName: string): ZoningRecord => ({
  zoneName, zoneCode: null, zoneShortName: null, buildingCoveragePct: null, floorAreaRatioPct: null, note: null,
});

interface FakeOptions {
  /** Radii (metres) at which this city has zoning. 0 means the point itself is inside a polygon. */
  hitsAt?: number[];
  bounds?: CityBounds;
  urbanPlanName?: string;
  failZones?: boolean;
}

/** Records every radius asked for, so tests can assert on the search order and request count. */
function fakeSource(city: UrbanPlanCity, options: FakeOptions = {}) {
  const zoneCalls: number[] = [];
  const contextCalls: number[] = [];
  const hitsAt = options.hitsAt ?? [];
  const source: CityUrbanPlanSource = {
    city,
    bounds: options.bounds ?? { minLatitude: 20, maxLatitude: 27, minLongitude: 118, maxLongitude: 123 },
    async fetchZones(query: CityQuery) {
      zoneCalls.push(query.radiusM);
      if (options.failZones) throw new ArcgisError("layer offline");
      return { zones: hitsAt.includes(query.radiusM) ? [zone(`${city}住宅區`)] : [], warnings: [] };
    },
    async fetchContext(query: CityQuery) {
      contextCalls.push(query.radiusM);
      return { ...emptyContext(), urbanPlanName: options.urbanPlanName ?? null };
    },
    sourceMetadata: () => ({ provider: `${city}-fake`, sourceName: city, fetchedAt: new Date().toISOString(), isFixture: false }),
  };
  return { source, zoneCalls, contextCalls };
}

describe("urban plan router", () => {
  it("answers from the parcel the point sits in and stops asking other cities", async () => {
    const taipei = fakeSource("臺北市", { hitsAt: [0], urbanPlanName: "臺北市都市計畫" });
    const newTaipei = fakeSource("新北市", { hitsAt: [0] });
    const provider = createUrbanPlanProvider({ sources: [taipei.source, newTaipei.source] });

    const report = await provider.lookup(TAIPEI_STATION);

    expect(report.city).toBe("臺北市");
    expect(report.match).toBe("parcel");
    expect(report.searchRadiusM).toBe(0);
    expect(report.quality).toBe("observed");
    expect(report.zones).toEqual([zone("臺北市住宅區")]);
    expect(report.urbanPlanName).toBe("臺北市都市計畫");
    expect(report.warnings).toEqual([]);
    expect(newTaipei.zoneCalls).toEqual([]);
    expect(urbanPlanReportSchema.parse(report)).toBeTruthy();
  });

  it("prefers another city's parcel hit over a widened hit in the first city", async () => {
    // 永和 sits inside 臺北市's bounding box and within a block of its polygons across the 新店溪.
    // Widening the first city before trying the second would answer 新北市 addresses with 臺北市 data.
    const taipei = fakeSource("臺北市", { hitsAt: [45, 220] });
    const newTaipei = fakeSource("新北市", { hitsAt: [0] });
    const provider = createUrbanPlanProvider({ sources: [taipei.source, newTaipei.source] });

    const report = await provider.lookup(YONGHE);

    expect(report.city).toBe("新北市");
    expect(report.match).toBe("parcel");
    expect(taipei.zoneCalls).toEqual([0, 45]);
  });

  it("labels a block-level answer as nearby and says why it is not the parcel's zoning", async () => {
    const taipei = fakeSource("臺北市", { hitsAt: [45] });
    const provider = createUrbanPlanProvider({ sources: [taipei.source] });

    const report = await provider.lookup(TAIPEI_STATION);

    expect(report.match).toBe("nearby");
    expect(report.searchRadiusM).toBe(45);
    expect(report.warnings.some((warning) => warning.includes("不等同該地號的法定分區"))).toBe(true);
  });

  it("widens once past block range only after every city missed nearby", async () => {
    const taipei = fakeSource("臺北市", { hitsAt: [220] });
    const newTaipei = fakeSource("新北市", {});
    const provider = createUrbanPlanProvider({ sources: [taipei.source, newTaipei.source] });

    const report = await provider.lookup(TAIPEI_STATION);

    expect(report.city).toBe("臺北市");
    expect(report.match).toBe("nearby");
    expect(report.searchRadiusM).toBe(220);
    expect(taipei.zoneCalls).toEqual([0, 45, 220]);
    expect(newTaipei.zoneCalls).toEqual([0, 45]);
  });

  it("reports a miss as missing data rather than an empty success", async () => {
    const provider = createUrbanPlanProvider({ sources: [fakeSource("基隆市", {}).source] });

    const report = await provider.lookup({ latitude: 25.13, longitude: 121.74 });

    expect(report.match).toBe("none");
    expect(report.quality).toBe("missing");
    expect(report.searchRadiusM).toBeNull();
    expect(report.zones).toEqual([]);
    expect(report.warnings.some((warning) => warning.includes("查無使用分區資料"))).toBe(true);
  });

  it("keeps a failed layer visible in warnings instead of failing the lookup", async () => {
    const provider = createUrbanPlanProvider({ sources: [fakeSource("臺北市", { failZones: true }).source] });

    const report = await provider.lookup(TAIPEI_STATION);

    expect(report.match).toBe("none");
    expect(report.warnings.some((warning) => warning.includes("layer offline"))).toBe(true);
  });

  it("honours an explicit city and skips coordinate resolution", async () => {
    const taipei = fakeSource("臺北市", { hitsAt: [0] });
    const keelung = fakeSource("基隆市", { hitsAt: [0] });
    const provider = createUrbanPlanProvider({ sources: [taipei.source, keelung.source] });

    const report = await provider.lookup({ ...TAIPEI_STATION, city: "基隆市" });

    expect(report.city).toBe("基隆市");
    expect(taipei.zoneCalls).toEqual([]);
  });

  it("rejects coordinates no adapter covers instead of guessing a city", async () => {
    const taichung = { latitude: 24.143, longitude: 120.671 };
    const provider = createUrbanPlanProvider({
      sources: [fakeSource("臺北市", { hitsAt: [0], bounds: { minLatitude: 24.95, maxLatitude: 25.22, minLongitude: 121.45, maxLongitude: 121.67 } }).source],
    });

    await expect(provider.lookup(taichung)).rejects.toThrow(UrbanPlanCoverageError);
  });

  it("serves a repeated coordinate from cache instead of re-querying upstream", async () => {
    const keelung = fakeSource("基隆市", { hitsAt: [0] });
    const provider = createUrbanPlanProvider({ sources: [keelung.source] });

    await provider.lookup({ latitude: 25.1319, longitude: 121.7392 });
    await provider.lookup({ latitude: 25.1319, longitude: 121.7392 });

    expect(keelung.zoneCalls).toEqual([0, 45]);
  });

  it("does not serve a cached city for a different explicit city at the same point", async () => {
    const taipei = fakeSource("臺北市", { hitsAt: [0] });
    const keelung = fakeSource("基隆市", { hitsAt: [0] });
    const provider = createUrbanPlanProvider({ sources: [taipei.source, keelung.source] });

    const auto = await provider.lookup(TAIPEI_STATION);
    const forced = await provider.lookup({ ...TAIPEI_STATION, city: "基隆市" });

    expect(auto.city).toBe("臺北市");
    expect(forced.city).toBe("基隆市");
  });
});

describe("get_urban_plan agent tool", () => {
  const report = (city: UrbanPlanCity) => ({
    city, coordinate: TAIPEI_STATION, match: "parcel" as const, searchRadiusM: 0, zones: [zone(`${city}住宅區`)],
    urbanPlanName: null, detailPlanNames: [], planCases: [], overlays: [], quality: "observed" as const, sources: [], warnings: [],
  });

  function buildTool(lookup = vi.fn(async (input: { city?: UrbanPlanCity }) => report(input.city ?? "臺北市"))) {
    const stub = {} as never;
    const tools = createDomainTools({
      sessionId: "session-1", turnId: "turn-1",
      sessions: stub, preferences: stub, recommendations: stub, providers: stub,
      urbanPlan: { lookup: lookup as never },
      publish: () => undefined,
    });
    const tool = tools.find((candidate) => candidate.name === "get_urban_plan");
    if (!tool) throw new Error("get_urban_plan is not registered");
    return { tool, lookup };
  }

  it("is exposed to the agent alongside the district-level tools", () => {
    const { tool } = buildTool();
    expect(tool.label).toBe("查詢都市計畫使用分區");
    // The model must be told the three-city limit and the meaning of match, or it will over-claim.
    expect(tool.description).toContain("臺北市");
    expect(tool.description).toContain("nearby");
  });

  it("passes the coordinate through and returns the report as tool text", async () => {
    const { tool, lookup } = buildTool();

    const result = await tool.execute("call-1", TAIPEI_STATION, undefined);

    expect(lookup).toHaveBeenCalledWith({ latitude: 25.0478, longitude: 121.5637 }, undefined);
    expect(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}")).toMatchObject({ city: "臺北市", match: "parcel" });
  });

  it("forwards an explicit city and rejects one no adapter covers", async () => {
    const { tool, lookup } = buildTool();

    await tool.execute("call-1", { ...TAIPEI_STATION, city: "基隆市" }, undefined);
    expect(lookup).toHaveBeenCalledWith({ ...TAIPEI_STATION, city: "基隆市" }, undefined);

    await expect(tool.execute("call-2", { ...TAIPEI_STATION, city: "桃園市" }, undefined)).rejects.toThrow("只接受");
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});

describe("ArcGIS query layer", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (body: unknown) => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    return calls;
  };

  const baseQuery = { serviceUrl: "https://example.test/MapServer", layerId: 2, latitude: 25.0478, longitude: 121.5637, outFields: "使用分區", timeoutMs: 1_000 };

  it("queries the bare point at radius 0", async () => {
    const calls = stubFetch({ features: [{ attributes: { 使用分區: "第三種住宅區" } }] });

    const features = await queryArcgisLayer({ ...baseQuery, radiusM: 0 });

    expect(features).toEqual([{ attributes: { 使用分區: "第三種住宅區" } }]);
    const url = new URL(calls[0] ?? "");
    expect(url.searchParams.get("geometryType")).toBe("esriGeometryPoint");
    expect(JSON.parse(url.searchParams.get("geometry") ?? "{}")).toMatchObject({ x: 121.5637, y: 25.0478 });
  });

  it("turns a radius into an envelope scaled for longitude at that latitude", async () => {
    const calls = stubFetch({ features: [] });

    await queryArcgisLayer({ ...baseQuery, radiusM: 45 });

    const url = new URL(calls[0] ?? "");
    expect(url.searchParams.get("geometryType")).toBe("esriGeometryEnvelope");
    const geometry = JSON.parse(url.searchParams.get("geometry") ?? "{}") as { xmin: number; ymin: number; xmax: number; ymax: number };
    const halfLat = (geometry.ymax - geometry.ymin) / 2;
    const halfLon = (geometry.xmax - geometry.xmin) / 2;
    expect(halfLat).toBeCloseTo(45 / 110_540, 8);
    // A degree of longitude is shorter than a degree of latitude at 25°N, so the box is wider in x.
    expect(halfLon).toBeGreaterThan(halfLat);
    expect(halfLon * 111_320 * Math.cos((25.0478 * Math.PI) / 180)).toBeCloseTo(45, 4);
  });

  it("treats an error body served with HTTP 200 as a failure", async () => {
    stubFetch({ error: { code: 498, message: "Invalid Token" } });

    const failure = await queryArcgisLayer({ ...baseQuery, radiusM: 0 }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ArcgisError);
    expect(isTokenError(failure)).toBe(true);
  });

  it("ignores a response with no feature array rather than throwing", async () => {
    stubFetch({ objectIdFieldName: "OBJECTID" });

    await expect(queryArcgisLayer({ ...baseQuery, radiusM: 0 })).resolves.toEqual([]);
  });

  it("honours the caller's abort signal on top of its own timeout", async () => {
    // The agent tool always passes a signal, so the request signal is a composite of both. Only the
    // caller's half is easy to get wrong, hence this test.
    const controller = new AbortController();
    vi.stubGlobal("fetch", (_url: string, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted by caller")), { once: true });
    }));

    const pending = queryArcgisLayer({ ...baseQuery, radiusM: 0, timeoutMs: 60_000, signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toThrow(ArcgisError);
  });
});

describe("ArcGIS field coercion", () => {
  it("treats the blank placeholders these services emit as absent", () => {
    expect(optionalString(" ")).toBeNull();
    expect(optionalString("")).toBeNull();
    expect(optionalString(null)).toBeNull();
    expect(optionalString(" 第三種住宅區 ")).toBe("第三種住宅區");
  });

  it("reads percentages as numbers and refuses to invent one", () => {
    expect(optionalPercent(300)).toBe(300);
    expect(optionalPercent("225")).toBe(225);
    // 道路用地 and similar rows carry 0, which means "not applicable", not "0% floor area ratio".
    expect(optionalPercent(0)).toBeNull();
    expect(optionalPercent(null)).toBeNull();
    expect(optionalPercent("")).toBeNull();
  });
});
