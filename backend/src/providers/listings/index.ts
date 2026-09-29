import pg from "pg";
import type { PreferenceState } from "../../domain/preferences/schema.js";
import type { EmbeddingProvider } from "../../embeddings/provider.js";
import { vectorLiteral } from "../../embeddings/provider.js";
import type { ListingFact } from "../../database/listing-ingestion.js";

const { Pool } = pg;
const DIMENSIONS = ["price", "value", "weather", "location", "amenities", "space", "quality", "hazard"] as const;
type Dimension = typeof DIMENSIONS[number];
type Mode = "sale" | "rent";

export interface RankedListing {
  id: string; title: string; url: string; city: string; district: string; address: string;
  price: number; unitPrice: number; area: number; layout: string; floor: number; totalFloor: number;
  age: number; buildingType: string; hasElevator: boolean; hasParking: boolean; score: number;
  semanticScore: number; topDimensions: { dimension: string; subscore: number; weight: number }[];
  matchReasons: string[]; distToMetro: number | null; commuteToCbdMin: number | null;
  pricePercentile: number | null; dataGaps: string[];
}

export interface RankListingsResult {
  mode: Mode; total: number; relaxations: string[]; listings: RankedListing[]; results: ScoredListing[];
  resolvedPlace?: { lat: number; lng: number; radiusKm: number; label: string } | null;
  unresolvedPlace?: string; effectiveProfile?: unknown;
}

export interface RankListingsInput {
  sessionId: string; preferences: PreferenceState; semanticQuery?: string; mode?: Mode; limit?: number;
  near?: { place: string; radiusKm?: number }; signal?: AbortSignal;
}

export interface DatasetSummary {
  mode: Mode; total: number; cities: string[];
  districts: { city: string; district: string; count: number; medianPrice: number; medianArea: number }[];
  priceUnit: string; source: string;
}

export interface SearchProfile {
  mode: Mode; weights: Record<Dimension, number>; hard: Record<string, unknown>;
  soft?: Record<string, unknown>; notes?: string[];
}

export interface ListingsProvider {
  available(): Promise<boolean>;
  count(): Promise<number>;
  rank(input: RankListingsInput): Promise<RankListingsResult>;
  search(profile: SearchProfile, semanticQuery?: string, limit?: number, signal?: AbortSignal): Promise<RankListingsResult>;
  describe(mode: Mode, signal?: AbortSignal): Promise<DatasetSummary>;
  rows(mode: Mode): Promise<Array<{ city: string; district: string; price: number; area: number }>>;
  districts(): Promise<Array<{ city: string; name: string; lat: number; lng: number; listing_count: number }>>;
  close(): Promise<void>;
}

export interface ScoredListing {
  id: string; source: string; sourceId: string; mode: Mode; url: string; title: string; scrapedAt: number;
  city: string; district: string; address: string; lat: number; lng: number; price: number; unitPrice: number;
  area: number; layout: string; rooms: number; floor: number; totalFloor: number; age: number;
  buildingType: string; hasElevator: boolean; hasParking: boolean;
  features: Record<string, number | string | boolean | null>; details: Record<string, unknown>;
  facts: ListingFact[];
  score: number; semanticScore: number;
  breakdown: Record<Dimension, { subscore: number; weight: number; contribution: number }>;
  matchReasons: string[]; dataGaps: string[];
  view: ListingView;
}

export interface ListingView {
  rankLabel: string;
  locationLabel: string;
  priceText: string;
  summaryText: string;
  score: { label: string; starsText: string; fillPercent: number };
  scores: Array<{ key: string; label: string; starsText: string; fillPercent: number; barPercent: number; pointsText: string; lead: boolean }>;
  cardFacts: Array<{ key: string; label: string; value: string; wide: boolean }>;
  detailFacts: Array<{ key: string; label: string; value: string; wide: boolean; group: string }>;
  strengths: string[];
  tradeoffs: string[];
  marker: { label: string; title: string; color: string; size: number; zIndex: number };
  action: { label: string; url: string } | null;
}

interface ListingRow {
  id: string; source: string; source_id: string; mode: Mode; url: string; title: string; scraped_at: Date;
  city: string; district: string; address: string; lat: number; lng: number; price: number; unit_price: number;
  area: number; layout: string; rooms: number; floor: number; total_floor: number; age: number;
  building_type: string; has_elevator: boolean; has_parking: boolean; details: Record<string, unknown>;
  features: Record<string, number | string | boolean | null>; facts: ListingFact[]; semantic_score: number;
}

export class ListingsUnavailableError extends Error {}

export function createListingsProvider(options: { databaseUrl: string; embeddings: EmbeddingProvider }): ListingsProvider {
  const pool = new Pool({ connectionString: options.databaseUrl });

  const search = async (profile: SearchProfile, semanticQuery = "", limit = 100, signal?: AbortSignal): Promise<RankListingsResult> => {
    try {
      const vector = semanticQuery.trim() ? await options.embeddings.embed(semanticQuery, signal) : null;
      const values: unknown[] = [profile.mode];
      const where = ["mode = $1"];
      const hard = profile.hard;
      const selectedCities = stringArray(hard.cities);
      const regionCities = stringArray(hard.regions).flatMap((region) => REGION_CITIES[region] ?? []);
      const cityFilter = selectedCities.length && regionCities.length ? selectedCities.filter((city) => regionCities.includes(city)) : selectedCities.length ? selectedCities : regionCities;
      addArrayFilter(where, values, "city", cityFilter, false);
      addArrayFilter(where, values, "district", stringArray(hard.districts), false);
      addArrayFilter(where, values, "city", stringArray(hard.excludedCities), true);
      addArrayFilter(where, values, "district", stringArray(hard.excludedDistricts), true);
      addCoreNumberFilter(where, values, "price", ">=", numberValue(hard.budgetMin), "price");
      addCoreNumberFilter(where, values, "price", "<=", numberValue(hard.budgetMax), "price");
      addCoreNumberFilter(where, values, "area", ">=", numberValue(hard.minArea), "area");
      addCoreNumberFilter(where, values, "rooms", ">=", numberValue(hard.minRooms), "rooms");
      addCoreNumberFilter(where, values, "age", "<=", numberValue(hard.maxAge), "age");
      addBooleanFilter(where, values, "has_elevator", hard.needElevator);
      addBooleanFilter(where, values, "has_parking", hard.needParking);
      const buildingTypes = stringArray(hard.buildingTypes);
      if (buildingTypes.length) {
        values.push(buildingTypes.map((value) => `%${value}%`));
        where.push(`building_type LIKE ANY($${values.length}::text[])`);
      }
      const maxMetro = numberValue(hard.maxDistToMetro);
      if (maxMetro !== undefined) {
        values.push(maxMetro);
        where.push(`(features->>'distToMetro')::double precision <= $${values.length}`);
      }
      const maxCommute = numberValue(hard.maxCommuteMinutes);
      if (maxCommute !== undefined) {
        values.push(maxCommute);
        where.push(`(features->>'commuteToCbdMin')::double precision <= $${values.length}`);
      }
      const near = parseNear(hard.near);
      if (near) {
        values.push(near.lat, near.lng, near.radiusKm);
        const lat = `$${values.length - 2}`;
        const lng = `$${values.length - 1}`;
        const radius = `$${values.length}`;
        where.push(`6371 * acos(least(1, cos(radians(${lat}::double precision)) * cos(radians(lat)) * cos(radians(lng) - radians(${lng}::double precision)) + sin(radians(${lat}::double precision)) * sin(radians(lat)))) <= ${radius}::double precision`);
      }
      let semanticSelect = "0.5::double precision AS semantic_score";
      let order = "indexed_at DESC";
      if (vector) {
        values.push(vectorLiteral(vector));
        const ref = `$${values.length}::vector`;
        semanticSelect = `1 - (embedding <=> ${ref}) AS semantic_score`;
        order = `embedding <=> ${ref}`;
        where.push("embedding IS NOT NULL");
      }
      values.push(Math.min(Math.max(limit * 6, 100), 600));
      const result = await pool.query<ListingRow>({ text: `SELECT *, ${semanticSelect} FROM listings WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT $${values.length}`, values, ...(signal ? { signal } : {}) });
      const scored = scoreRows(result.rows, profile, Boolean(vector)).slice(0, Math.min(Math.max(limit, 1), 500));
      return { mode: profile.mode, total: scored.length, relaxations: scored.length ? [] : ["硬條件沒有符合的物件，地區與必要條件未自動放寬。"], listings: scored.slice(0, 20).map(project), results: scored, effectiveProfile: profile };
    } catch (error) {
      throw new ListingsUnavailableError(error instanceof Error ? error.message : String(error));
    }
  };

  return {
    async available() {
      try { return (await pool.query<{ available: boolean }>("SELECT to_regclass('public.listings') IS NOT NULL AS available")).rows[0]?.available === true; }
      catch { return false; }
    },
    async count() { return Number((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM listings")).rows[0]?.count ?? 0); },
    async rank(input) {
      const mode = input.mode ?? input.preferences.hardConstraints.mode ?? "sale";
      const profile = profileFromPreferences(input.preferences, mode);
      const modelLimit = Math.min(Math.max(input.limit ?? 8, 1), 20);
      if (input.near) {
        const resolved = await resolvePlace(pool, input.near.place, input.near.radiusKm);
        if (!resolved) return { mode, total: 0, relaxations: [], listings: [], results: [], unresolvedPlace: input.near.place, effectiveProfile: profile };
        profile.hard.near = resolved;
        const result = await search(profile, input.semanticQuery, 100, input.signal);
        return { ...result, listings: result.listings.slice(0, modelLimit), resolvedPlace: resolved };
      }
      const result = await search(profile, input.semanticQuery, 100, input.signal);
      return { ...result, listings: result.listings.slice(0, modelLimit) };
    },
    search,
    async describe(mode, signal) {
      const result = await pool.query<{ city: string; district: string; count: number; median_price: number; median_area: number }>({ text: "SELECT city, district, count(*)::int AS count, percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::float AS median_price, percentile_cont(0.5) WITHIN GROUP (ORDER BY area)::float AS median_area FROM listings WHERE mode = $1 GROUP BY city, district ORDER BY count(*) DESC", values: [mode], ...(signal ? { signal } : {}) });
      return { mode, total: result.rows.reduce((sum, row) => sum + row.count, 0), cities: [...new Set(result.rows.map((row) => row.city))], districts: result.rows.map((row) => ({ city: row.city, district: row.district, count: row.count, medianPrice: row.median_price, medianArea: row.median_area })), priceUnit: mode === "sale" ? "萬元（總價）" : "元／月", source: "物件向量資料庫" };
    },
    async rows(mode) { return (await pool.query("SELECT city, district, price, area FROM listings WHERE mode = $1", [mode])).rows; },
    async districts() { return (await pool.query("SELECT city, district AS name, avg(lat)::float AS lat, avg(lng)::float AS lng, count(*)::int AS listing_count FROM listings GROUP BY city, district")).rows; },
    async close() { await pool.end(); },
  };
}

function profileFromPreferences(preferences: PreferenceState, mode: Mode): SearchProfile {
  const hard = preferences.hardConstraints;
  return {
    mode,
    weights: { price: (preferences.listingPreferences.priceWeight ?? preferences.softPreferences.housing.weight) * 100, value: (preferences.listingPreferences.valueWeight ?? preferences.softPreferences.housing.preferLowerRent) * 100, weather: preferences.softPreferences.climate.weight * 100, location: preferences.softPreferences.transportation.weight * 100, amenities: preferences.softPreferences.amenities.weight * 100, space: (preferences.listingPreferences.spaceWeight ?? 0.5) * 100, quality: (preferences.listingPreferences.qualityWeight ?? 0.5) * 100, hazard: preferences.listingPreferences.hazardWeight * 100 },
    hard: { regions: hard.regions, cities: hard.cities, districts: hard.districts, excludedCities: hard.excludedCities, excludedDistricts: hard.excludedDistricts, budgetMin: mode === "sale" ? hard.minTotalPriceWan : hard.minMonthlyRent, budgetMax: mode === "sale" ? hard.maxTotalPriceWan : hard.maxMonthlyRent, minArea: hard.minArea, minRooms: hard.minRooms, maxAge: hard.maxAge, buildingTypes: hard.buildingTypes, needElevator: hard.needElevator, needParking: hard.needParking, maxDistToMetro: hard.maxWalkMinutesToMetro === undefined ? undefined : hard.maxWalkMinutesToMetro * 80, maxCommuteMinutes: hard.maxCommuteMinutes },
  };
}

function scoreRows(rows: ListingRow[], profile: SearchProfile, hasSemanticQuery: boolean): ScoredListing[] {
  const prices = rows.filter((row) => !missingCoreSet(row.details).has("price")).map((row) => Number(row.price));
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const scored: Array<Omit<ScoredListing, "view">> = rows.map((row) => {
    const missing = missingCoreSet(row.details);
    const feature = (key: string) => numberValue(row.features[key] ?? row.features[toSnake(key)]);
    const amenityValues = [feature("poiConvenience500"), feature("poiSupermarket500"), feature("poiHospital1k"), feature("poiPark500")];
    const flood = feature("floodIncidents500");
    const liquefaction = feature("liquefactionLevel");
    const scores: Record<Dimension, number> = {
      price: missing.has("price") ? 0.5 : maxPrice === minPrice ? 0.7 : 1 - (row.price - minPrice) / (maxPrice - minPrice),
      value: 1 - (feature("pricePercentile") ?? 0.5),
      weather: average([closeness(feature("summerTemp"), 26, 8), 1 - clamp((feature("rainDays") ?? 150) / 260), 1 - clamp((feature("annualRainfall") ?? 2500) / 5000)]),
      location: average([inverseDistance(feature("distToMetro"), 1500), inverseDistance(feature("commuteToCbdMin"), 60)]),
      amenities: amenityValues.every((value) => value === undefined) ? 0.5 : clamp(((amenityValues[0] ?? 0) + (amenityValues[1] ?? 0) * 2 + (amenityValues[2] ?? 0) * 2 + (amenityValues[3] ?? 0)) / 25),
      space: average([missing.has("area") ? 0.5 : clamp(row.area / 40), missing.has("rooms") ? 0.5 : clamp(row.rooms / 4)]),
      quality: average([missing.has("age") ? 0.5 : 1 - clamp(row.age / 50), missing.has("hasElevator") ? 0.5 : row.has_elevator ? 1 : 0.35, missing.has("hasParking") ? 0.5 : row.has_parking ? 1 : 0.45, numberValue(row.details.daylightScore) ?? 0.5]),
      hazard: average([flood === undefined ? 0.5 : 1 - clamp(flood / 5), liquefaction === undefined ? 0.5 : 1 - clamp((liquefaction - 1) / 2)]),
    };
    const weights = DIMENSIONS.map((dimension) => Math.max(profile.weights[dimension] ?? 0, 0));
    const weightTotal = weights.reduce((sum, value) => sum + value, 0) || 1;
    const structured = DIMENSIONS.reduce((sum, dimension, index) => sum + scores[dimension] * (weights[index] ?? 0), 0) / weightTotal;
    const semanticScore = clamp(Number(row.semantic_score ?? 0.5));
    const score = hasSemanticQuery ? structured * 0.6 + semanticScore * 0.4 : structured;
    const breakdown = Object.fromEntries(DIMENSIONS.map((dimension, index) => [dimension, { subscore: scores[dimension], weight: (weights[index] ?? 0) / weightTotal, contribution: scores[dimension] * ((weights[index] ?? 0) / weightTotal) }])) as ScoredListing["breakdown"];
    const top = DIMENSIONS.map((dimension) => ({ dimension, ...breakdown[dimension] })).sort((a, b) => b.contribution - a.contribution).slice(0, 3);
    const dataGaps = [...(feature("distToMetro") === undefined ? ["distToMetro"] : []), ...(feature("pricePercentile") === undefined ? ["pricePercentile"] : []), ...(flood === undefined ? ["floodIncidents500"] : []), ...(liquefaction === undefined ? ["liquefactionLevel"] : [])];
    return { id: row.id, source: row.source, sourceId: row.source_id, mode: row.mode, url: row.url, title: row.title, scrapedAt: new Date(row.scraped_at).getTime(), city: row.city, district: row.district, address: row.address, lat: Number(row.lat), lng: Number(row.lng), price: Number(row.price), unitPrice: Number(row.unit_price), area: Number(row.area), layout: row.layout, rooms: row.rooms, floor: row.floor, totalFloor: row.total_floor, age: Number(row.age), buildingType: row.building_type, hasElevator: row.has_elevator, hasParking: row.has_parking, features: row.features, details: row.details, facts: row.facts ?? [], score: clamp(score), semanticScore, breakdown, matchReasons: [...(hasSemanticQuery && semanticScore >= 0.6 ? ["語意需求相符"] : []), ...top.map((item) => `${dimensionLabel(item.dimension)} ${Math.round(item.subscore * 100)}%`)], dataGaps };
  });
  return scored.sort((a, b) => b.score - a.score).map((listing, index, all) => ({ ...listing, view: buildListingView(listing, index, all.length) }));
}

function buildListingView(listing: Omit<ScoredListing, "view">, index: number, total: number): ListingView {
  const missing = missingCoreSet(listing.details);
  const known = (key: string, value: string) => missing.has(key) ? "未提供" : value;
  const scoreRows = DIMENSIONS.map((key) => ({ key, label: dimensionLabel(key), ...listing.breakdown[key] }));
  const peak = Math.max(...scoreRows.map((row) => row.subscore));
  const active = scoreRows.filter((row) => row.weight > 0).sort((a, b) => b.subscore - a.subscore);
  const ranked = active.length ? active : [...scoreRows].sort((a, b) => b.subscore - a.subscore);
  const core = [
    { key: "address", label: "地址", value: listing.address || "—", wide: true, group: "基本資料" },
    { key: "price", label: listing.mode === "rent" ? "月租" : "總價", value: known("price", formatPrice(listing.mode, listing.price)), wide: false, group: "基本資料" },
    { key: "unitPrice", label: "單價", value: known("unitPrice", `${listing.unitPrice.toLocaleString("zh-Hant-TW")} ${listing.mode === "rent" ? "元／坪" : "萬／坪"}`), wide: false, group: "基本資料" },
    { key: "area", label: "坪數", value: known("area", `${listing.area.toFixed(1)} 坪`), wide: false, group: "基本資料" },
    { key: "layout", label: "格局", value: known("layout", listing.layout || "—"), wide: false, group: "基本資料" },
    { key: "floor", label: "樓層", value: known("floor", missing.has("totalFloor") ? `${listing.floor} 樓` : `${listing.floor}／${listing.totalFloor} 樓`), wide: false, group: "基本資料" },
    { key: "age", label: "屋齡", value: known("age", `${listing.age.toFixed(0)} 年`), wide: false, group: "基本資料" },
    { key: "buildingType", label: "建物類型", value: known("buildingType", listing.buildingType || "—"), wide: false, group: "基本資料" },
    { key: "hasElevator", label: "電梯", value: known("hasElevator", listing.hasElevator ? "有" : "無"), wide: false, group: "基本資料" },
    { key: "hasParking", label: "車位", value: known("hasParking", listing.hasParking ? "有" : "無"), wide: false, group: "基本資料" },
    { key: "source", label: "刊登來源", value: listing.source || "—", wide: false, group: "來源" },
  ];
  const dynamic = listing.facts.map((fact) => ({ key: fact.key, label: fact.label, value: fact.displayValue, wide: false, group: fact.group }));
  const preferred = ["distToMetro", "commuteToCbdMin", "summerTemp", "annualRainfall", "rainDays", "poiConvenience500", "poiPark500"];
  const cardFacts = preferred.map((key) => dynamic.find((fact) => fact.key === key)).filter((fact): fact is NonNullable<typeof fact> => Boolean(fact)).slice(0, 6);
  return {
    rankLabel: `第 ${index + 1} 名`,
    locationLabel: `${listing.city}${listing.district}`,
    priceText: known("price", formatPrice(listing.mode, listing.price)),
    summaryText: [known("area", `${listing.area.toFixed(1)} 坪`), known("layout", listing.layout || "—"), known("age", `屋齡 ${listing.age.toFixed(0)} 年`), known("floor", missing.has("totalFloor") ? `${listing.floor} 樓` : `${listing.floor}/${listing.totalFloor} 樓`)].join("・"),
    score: { label: "整體評分", ...starView(listing.score) },
    scores: scoreRows.map((row) => ({ key: row.key, label: row.label, ...starView(row.subscore), barPercent: Math.round(row.subscore * 100), pointsText: `${Math.round(row.subscore * 100 * row.weight)} 分`, lead: row.subscore === peak })),
    cardFacts,
    detailFacts: [...core, ...dynamic],
    strengths: ranked[0] ? [`${ranked[0].label}表現較佳（${Math.round(ranked[0].subscore * 100)}）`] : [],
    tradeoffs: ranked[1] ? [`${ranked.at(-1)!.label}相對弱（${Math.round(ranked.at(-1)!.subscore * 100)}）`] : [],
    marker: { label: String(index + 1), title: `${listing.title}｜${Math.round(listing.score * 100)} 分`, color: rankColor(index, total), size: index < 3 ? 38 : 32, zIndex: total - index },
    action: listing.url ? { label: "查看原始物件 ↗", url: listing.url } : null,
  };
}

function starView(score: number) { return { starsText: `${(score * 5).toFixed(1)}`, fillPercent: Math.round(clamp(score) * 100) }; }

function formatPrice(mode: Mode, price: number): string {
  if (mode === "rent") return `${Math.round(price).toLocaleString("zh-Hant-TW")} 元/月`;
  return price >= 10_000 ? `${(price / 10_000).toFixed(1)} 億` : `${Math.round(price).toLocaleString("zh-Hant-TW")} 萬`;
}

function rankColor(index: number, total: number): string {
  const position = total <= 1 ? 0 : index / (total - 1);
  const stops = position <= 0.5 ? [[90, 97, 72], [155, 106, 67], position * 2] : [[155, 106, 67], [107, 75, 52], (position - 0.5) * 2];
  const from = stops[0] as number[]; const to = stops[1] as number[]; const amount = stops[2] as number;
  return `rgb(${from.map((value, i) => Math.round(value + ((to[i] ?? value) - value) * amount)).join(", ")})`;
}

function project(listing: ScoredListing): RankedListing {
  return { id: listing.id, title: listing.title, url: listing.url, city: listing.city, district: listing.district, address: listing.address, price: listing.price, unitPrice: listing.unitPrice, area: listing.area, layout: listing.layout, floor: listing.floor, totalFloor: listing.totalFloor, age: listing.age, buildingType: listing.buildingType, hasElevator: listing.hasElevator, hasParking: listing.hasParking, score: round(listing.score), semanticScore: round(listing.semanticScore), matchReasons: listing.matchReasons, topDimensions: DIMENSIONS.map((dimension) => ({ dimension, subscore: round(listing.breakdown[dimension].subscore), weight: round(listing.breakdown[dimension].weight) })).sort((a, b) => b.subscore * b.weight - a.subscore * a.weight).slice(0, 3), distToMetro: numberValue(listing.features.distToMetro) ?? null, commuteToCbdMin: numberValue(listing.features.commuteToCbdMin) ?? null, pricePercentile: numberValue(listing.features.pricePercentile) ?? null, dataGaps: listing.dataGaps };
}

async function resolvePlace(pool: pg.Pool, place: string, radiusKm?: number) {
  const normalized = place.replace(/台/g, "臺").trim();
  const result = await pool.query<{ city: string; district: string; lat: number; lng: number }>("SELECT city, district, avg(lat)::float AS lat, avg(lng)::float AS lng FROM listings WHERE city LIKE $1 OR district LIKE $1 GROUP BY city, district ORDER BY CASE WHEN district = $2 OR city = $2 THEN 0 ELSE 1 END LIMIT 1", [`%${normalized}%`, normalized]);
  const row = result.rows[0];
  return row ? { lat: row.lat, lng: row.lng, radiusKm: radiusKm ?? 5, label: `${row.city}${row.district}` } : null;
}

function addArrayFilter(where: string[], values: unknown[], column: string, items: string[], excluded: boolean) { if (items.length) { values.push(items); where.push(`${column} ${excluded ? "<> ALL" : "= ANY"}($${values.length}::text[])`); } }
function addNumberFilter(where: string[], values: unknown[], column: string, operator: string, value?: number) { if (value !== undefined) { values.push(value); where.push(`${column} ${operator} $${values.length}`); } }
function addCoreNumberFilter(where: string[], values: unknown[], column: string, operator: string, value: number | undefined, key: string) { if (value !== undefined) { addNumberFilter(where, values, column, operator, value); where.push(`NOT (COALESCE(details->'_missingCore', '[]'::jsonb) ? '${key}')`); } }
function addBooleanFilter(where: string[], values: unknown[], column: string, value: unknown) { if (value === true) { values.push(true); where.push(`${column} = $${values.length}`); } }
function parseNear(value: unknown): { lat: number; lng: number; radiusKm: number } | null { if (!value || typeof value !== "object") return null; const candidate = value as Record<string, unknown>; const lat = numberValue(candidate.lat); const lng = numberValue(candidate.lng); const radiusKm = numberValue(candidate.radiusKm); return lat === undefined || lng === undefined || radiusKm === undefined ? null : { lat, lng, radiusKm }; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : []; }
function numberValue(value: unknown): number | undefined { const parsed = typeof value === "number" ? value : typeof value === "string" && value ? Number(value) : NaN; return Number.isFinite(parsed) ? parsed : undefined; }
function clamp(value: number): number { return Math.min(Math.max(value, 0), 1); }
function average(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function missingCoreSet(details: Record<string, unknown>): Set<string> { return new Set(Array.isArray(details._missingCore) ? details._missingCore.filter((value): value is string => typeof value === "string") : []); }
function closeness(value: number | undefined, target: number, range: number): number { return value === undefined ? 0.5 : 1 - clamp(Math.abs(value - target) / range); }
function inverseDistance(value: number | undefined, scale: number): number { return value === undefined ? 0.5 : 1 / (1 + value / scale); }
function round(value: number): number { return Math.round(value * 100) / 100; }
function toSnake(value: string): string { return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`); }
function dimensionLabel(value: Dimension): string { return { price: "價格", value: "性價比", weather: "氣候", location: "交通", amenities: "機能", space: "空間", quality: "屋況", hazard: "風險" }[value]; }
const REGION_CITIES: Record<string, string[]> = { 北部: ["臺北市", "新北市", "基隆市", "桃園市", "新竹市", "新竹縣", "宜蘭縣"], 中部: ["臺中市", "苗栗縣", "彰化縣", "南投縣", "雲林縣"], 南部: ["高雄市", "臺南市", "嘉義市", "嘉義縣", "屏東縣"], 東部: ["花蓮縣", "臺東縣"], 離島: ["澎湖縣", "金門縣", "連江縣"] };
