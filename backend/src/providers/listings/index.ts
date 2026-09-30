import pg from "pg";
import type { PreferenceState } from "../../domain/preferences/schema.js";
import type { EmbeddingProvider } from "../../embeddings/provider.js";
import { vectorLiteral } from "../../embeddings/provider.js";
import type { ListingFact } from "../../database/listing-ingestion.js";
import type { AssessmentCandidate, CandidateAssessment, ListingEvaluator } from "../../assessment/evaluator.js";

const { Pool } = pg;
type Mode = "sale" | "rent";

export interface SearchProfile {
  mode: Mode;
  hard: Record<string, unknown>;
  notes?: string[];
}

export interface SearchResult {
  id: string;
  title: string;
  source: { id: string; name: string; url: string };
  location: { address: string; lat: number; lng: number };
  facts: ListingFact[];
  assessment: CandidateAssessment;
  view: ListingView;
}

export interface ListingView {
  rankLabel: string;
  locationLabel: string;
  cardFacts: Array<{ key: string; label: string; value: string; wide: boolean }>;
  detailFacts: Array<{ key: string; label: string; value: string; wide: boolean; group: string }>;
  marker: { label: string; title: string; color: string; size: number; zIndex: number };
  action: { label: string; url: string } | null;
}

export interface RankedListing {
  id: string;
  title: string;
  source: string;
  url: string;
  address: string;
  lat: number;
  lng: number;
  score: number;
  confidence: number;
  summary: string;
  strengths: string[];
  tradeoffs: string[];
  missingInformation: string[];
  facts: Array<{ label: string; value: string; evidence?: string }>;
}

export interface RankListingsResult {
  mode: Mode;
  total: number;
  relaxations: string[];
  criteria: Array<{ description: string; importance: "required" | "high" | "medium" | "low" }>;
  listings: RankedListing[];
  results: SearchResult[];
  resolvedPlace?: { lat: number; lng: number; radiusKm: number; label: string } | null;
  unresolvedPlace?: string;
  effectiveProfile?: unknown;
}

export interface RankListingsInput {
  sessionId: string;
  preferences: PreferenceState;
  semanticQuery?: string;
  mode?: Mode;
  limit?: number;
  near?: { place: string; radiusKm?: number };
  signal?: AbortSignal;
}

export interface DatasetSummary {
  mode: Mode;
  total: number;
  cities: string[];
  districts: { city: string; district: string; count: number; medianPrice: number; medianArea: number }[];
  priceUnit: string;
  source: string;
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

interface ListingRow {
  id: string;
  source: string;
  source_id: string;
  mode: Mode;
  url: string;
  title: string;
  city: string;
  district: string;
  address: string;
  lat: number;
  lng: number;
  price: number;
  unit_price: number;
  area: number;
  layout: string;
  rooms: number;
  floor: number;
  total_floor: number;
  age: number;
  building_type: string;
  has_elevator: boolean;
  has_parking: boolean;
  details: Record<string, unknown>;
  features: Record<string, number | string | boolean | null>;
  facts: ListingFact[];
  semantic_score: number;
}

export class ListingsUnavailableError extends Error {}

export function createListingsProvider(options: { databaseUrl: string; embeddings: EmbeddingProvider; evaluator: ListingEvaluator }): ListingsProvider {
  const pool = new Pool({ connectionString: options.databaseUrl });

  const search = async (profile: SearchProfile, semanticQuery = "", limit = 20, signal?: AbortSignal): Promise<RankListingsResult> => {
    try {
      const query = semanticQuery.trim() || profile.notes?.join(" ").trim() || "根據所有已知資料找出最適合的物件";
      const vector = query ? await options.embeddings.embed(query, signal) : null;
      const values: unknown[] = [profile.mode];
      const where = ["mode = $1"];
      applyHardFilters(where, values, profile.hard);
      let semanticSelect = "0.5::double precision AS semantic_score";
      let order = "indexed_at DESC";
      if (vector) {
        values.push(vectorLiteral(vector));
        const ref = `$${values.length}::vector`;
        semanticSelect = `1 - (embedding <=> ${ref}) AS semantic_score`;
        order = `embedding <=> ${ref}`;
        where.push("embedding IS NOT NULL");
      }
      const requested = Math.min(Math.max(limit, 1), 30);
      values.push(Math.min(Math.max(requested * 2, 20), 40));
      const rows = (await pool.query<ListingRow>({ text: `SELECT *, ${semanticSelect} FROM listings WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT $${values.length}`, values, ...(signal ? { signal } : {}) })).rows;
      if (rows.length === 0) return { mode: profile.mode, total: 0, relaxations: ["必要條件沒有符合的物件，條件未自動放寬。"], criteria: [], listings: [], results: [], effectiveProfile: profile };
      const candidates = rows.map(toAssessmentCandidate);
      const evaluated = await options.evaluator.evaluate(query, candidates, signal);
      const ordered = rows
        .map((row) => ({ row, assessment: evaluated.assessments.get(row.id) ?? semanticAssessment(row) }))
        .sort((a, b) => b.assessment.score - a.assessment.score || b.assessment.confidence - a.assessment.confidence)
        .slice(0, requested);
      const results = ordered.map((item, index, all) => toSearchResult(item.row, item.assessment, index, all.length));
      return {
        mode: profile.mode,
        total: results.length,
        relaxations: results.length ? [] : ["必要條件沒有符合的物件，條件未自動放寬。"],
        criteria: evaluated.criteria,
        listings: results.slice(0, 20).map(project),
        results,
        effectiveProfile: profile,
      };
    } catch (error) {
      if (isMissingRelation(error)) throw new ListingsUnavailableError("物件資料庫尚未建立，請先執行資料管線");
      throw error;
    }
  };

  return {
    async available() {
      try { return (await pool.query<{ available: boolean }>("SELECT to_regclass('public.listings') IS NOT NULL AS available")).rows[0]?.available === true; }
      catch { return false; }
    },
    async count() { return Number((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM listings")).rows[0]?.count ?? 0); },
    async rank(input) {
      const mode = input.mode ?? input.preferences.hardConstraints.mode ?? "rent";
      const profile = profileFromPreferences(input.preferences, mode);
      let resolvedPlace: RankListingsResult["resolvedPlace"];
      if (input.near?.place) {
        const resolved = await resolvePlace(pool, input.near.place, input.near.radiusKm);
        if (!resolved) return { mode, total: 0, relaxations: [], criteria: [], listings: [], results: [], unresolvedPlace: input.near.place, effectiveProfile: profile };
        profile.hard.near = resolved;
        resolvedPlace = resolved;
      }
      const result = await search(profile, input.semanticQuery ?? "", input.limit ?? 20, input.signal);
      return { ...result, ...(resolvedPlace ? { resolvedPlace } : {}) };
    },
    async describe(mode, signal) {
      const result = await pool.query<{ city: string; district: string; count: number; median_price: number; median_area: number }>({ text: "SELECT city, district, count(*)::int AS count, percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::float AS median_price, percentile_cont(0.5) WITHIN GROUP (ORDER BY area)::float AS median_area FROM listings WHERE mode = $1 GROUP BY city, district ORDER BY count(*) DESC", values: [mode], ...(signal ? { signal } : {}) });
      return { mode, total: result.rows.reduce((sum, row) => sum + row.count, 0), cities: [...new Set(result.rows.map((row) => row.city))], districts: result.rows.map((row) => ({ city: row.city, district: row.district, count: row.count, medianPrice: Number(row.median_price), medianArea: Number(row.median_area) })), priceUnit: mode === "rent" ? "元/月" : "萬元", source: "PostgreSQL listings" };
    },
    async rows(mode) { return (await pool.query("SELECT city, district, price, area FROM listings WHERE mode = $1", [mode])).rows; },
    async districts() { return (await pool.query("SELECT city, district AS name, avg(lat)::float AS lat, avg(lng)::float AS lng, count(*)::int AS listing_count FROM listings GROUP BY city, district")).rows; },
    async close() { await pool.end(); },
    search,
  };
}

function profileFromPreferences(preferences: PreferenceState, mode: Mode): SearchProfile {
  const hard = preferences.hardConstraints;
  return {
    mode,
    hard: {
      regions: hard.regions,
      cities: hard.cities,
      districts: hard.districts,
      excludedCities: hard.excludedCities,
      excludedDistricts: hard.excludedDistricts,
      budgetMin: mode === "sale" ? hard.minTotalPriceWan : hard.minMonthlyRent,
      budgetMax: mode === "sale" ? hard.maxTotalPriceWan : hard.maxMonthlyRent,
      minArea: hard.minArea,
      minRooms: hard.minRooms,
      maxAge: hard.maxAge,
      buildingTypes: hard.buildingTypes,
      needElevator: hard.needElevator,
      needParking: hard.needParking,
      maxDistToMetro: hard.maxWalkMinutesToMetro === undefined ? undefined : hard.maxWalkMinutesToMetro * 80,
      maxCommuteMinutes: hard.maxCommuteMinutes,
    },
  };
}

function toAssessmentCandidate(row: ListingRow): AssessmentCandidate {
  const facts = completeFacts(row);
  return {
    id: row.id,
    title: row.title,
    address: row.address,
    source: row.source,
    semanticScore: clamp(Number(row.semantic_score ?? 0.5)),
    facts: facts.map((fact) => ({ key: fact.key, label: fact.label, value: fact.value, displayValue: fact.displayValue, ...(fact.confidence === undefined ? {} : { confidence: fact.confidence }), ...(fact.evidence ? { evidence: fact.evidence.slice(0, 240) } : {}) })),
  };
}

function toSearchResult(row: ListingRow, assessment: CandidateAssessment, index: number, total: number): SearchResult {
  const facts = completeFacts(row);
  const matched = assessment.matchedFactKeys.map((key) => facts.find((fact) => fact.key === key)).filter((fact): fact is ListingFact => Boolean(fact));
  const cardFacts = [...matched, ...facts.filter((fact) => !assessment.matchedFactKeys.includes(fact.key))].slice(0, 6).map(toViewFact);
  return {
    id: row.id,
    title: row.title,
    source: { id: row.source_id, name: row.source, url: row.url },
    location: { address: row.address, lat: Number(row.lat), lng: Number(row.lng) },
    facts,
    assessment,
    view: {
      rankLabel: `第 ${index + 1} 名`,
      locationLabel: row.address,
      cardFacts,
      detailFacts: [
        { key: "address", label: "地址", value: row.address, wide: true, group: "位置" },
        { key: "coordinates", label: "座標", value: `${Number(row.lat).toFixed(6)}, ${Number(row.lng).toFixed(6)}`, wide: true, group: "位置" },
        { key: "source", label: "來源", value: row.source, wide: false, group: "來源" },
        ...facts.map((fact) => ({ ...toViewFact(fact), group: fact.group })),
      ],
      marker: { label: String(index + 1), title: `${row.title}｜匹配 ${assessment.score} 分`, color: rankColor(index, total), size: index < 3 ? 38 : 32, zIndex: total - index },
      action: row.url ? { label: "查看原始物件 ↗", url: row.url } : null,
    },
  };
}

function completeFacts(row: ListingRow): ListingFact[] {
  const missing = new Set(Array.isArray(row.details._missingCore) ? row.details._missingCore.filter((value): value is string => typeof value === "string") : []);
  const core: ListingFact[] = [];
  const add = (key: string, label: string, value: unknown, displayValue: string) => { if (!missing.has(key)) core.push({ key, label, group: "物件資料", value, displayValue, sourceName: row.source, sourceUrl: row.url }); };
  add("price", row.mode === "rent" ? "月租" : "總價", row.price, formatPrice(row.mode, row.price));
  add("unitPrice", "單價", row.unit_price, `${Number(row.unit_price).toLocaleString("zh-Hant-TW")} ${row.mode === "rent" ? "元／坪" : "萬／坪"}`);
  add("area", "坪數", row.area, `${Number(row.area).toFixed(1)} 坪`);
  add("layout", "格局", row.layout, row.layout);
  add("rooms", "房數", row.rooms, `${row.rooms} 房`);
  add("floor", "樓層", row.floor, missing.has("totalFloor") ? `${row.floor} 樓` : `${row.floor}／${row.total_floor} 樓`);
  add("age", "屋齡", row.age, `${Number(row.age).toFixed(0)} 年`);
  add("buildingType", "建物類型", row.building_type, row.building_type);
  add("hasElevator", "電梯", row.has_elevator, row.has_elevator ? "有" : "無");
  add("hasParking", "車位", row.has_parking, row.has_parking ? "有" : "無");
  const merged = new Map<string, ListingFact>();
  for (const fact of [...core, ...(row.facts ?? [])]) merged.set(fact.key, fact);
  return [...merged.values()];
}

function semanticAssessment(row: ListingRow): CandidateAssessment {
  const score = Math.round(clamp(Number(row.semantic_score ?? 0.5)) * 100);
  return { score, starsText: (score / 20).toFixed(1), confidence: 0.35, summary: "依目前資料與搜尋需求的語意相符程度排序。", strengths: [], tradeoffs: [], matchedFactKeys: [], missingInformation: [] };
}

function project(result: SearchResult): RankedListing {
  const cited = new Set(result.assessment.matchedFactKeys);
  return {
    id: result.id,
    title: result.title,
    source: result.source.name,
    url: result.source.url,
    address: result.location.address,
    lat: result.location.lat,
    lng: result.location.lng,
    score: result.assessment.score,
    confidence: result.assessment.confidence,
    summary: result.assessment.summary,
    strengths: result.assessment.strengths,
    tradeoffs: result.assessment.tradeoffs,
    missingInformation: result.assessment.missingInformation,
    facts: result.facts.filter((fact) => !cited.size || cited.has(fact.key)).slice(0, 12).map((fact) => ({ label: fact.label, value: fact.displayValue, ...(fact.evidence ? { evidence: fact.evidence } : {}) })),
  };
}

function applyHardFilters(where: string[], values: unknown[], hard: Record<string, unknown>): void {
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
  if (buildingTypes.length) { values.push(buildingTypes.map((value) => `%${value}%`)); where.push(`building_type LIKE ANY($${values.length}::text[])`); }
  addFeatureNumberFilter(where, values, "distToMetro", numberValue(hard.maxDistToMetro));
  addFeatureNumberFilter(where, values, "commuteToCbdMin", numberValue(hard.maxCommuteMinutes));
  const near = parseNear(hard.near);
  if (near) {
    values.push(near.lat, near.lng, near.radiusKm);
    const lat = `$${values.length - 2}`;
    const lng = `$${values.length - 1}`;
    const radius = `$${values.length}`;
    where.push(`6371 * acos(least(1, cos(radians(${lat}::double precision)) * cos(radians(lat)) * cos(radians(lng) - radians(${lng}::double precision)) + sin(radians(${lat}::double precision)) * sin(radians(lat)))) <= ${radius}::double precision`);
  }
}

async function resolvePlace(pool: pg.Pool, place: string, radiusKm?: number) {
  const normalized = place.replace(/台/g, "臺").trim();
  const result = await pool.query<{ city: string; district: string; lat: number; lng: number }>("SELECT city, district, avg(lat)::float AS lat, avg(lng)::float AS lng FROM listings WHERE city LIKE $1 OR district LIKE $1 GROUP BY city, district ORDER BY CASE WHEN district = $2 OR city = $2 THEN 0 ELSE 1 END LIMIT 1", [`%${normalized}%`, normalized]);
  const row = result.rows[0];
  return row ? { lat: row.lat, lng: row.lng, radiusKm: radiusKm ?? 5, label: `${row.city}${row.district}` } : null;
}

function toViewFact(fact: ListingFact) { return { key: fact.key, label: fact.label, value: fact.displayValue, wide: false }; }
function formatPrice(mode: Mode, price: number): string { return mode === "rent" ? `${Math.round(price).toLocaleString("zh-Hant-TW")} 元/月` : price >= 10_000 ? `${(price / 10_000).toFixed(1)} 億` : `${Math.round(price).toLocaleString("zh-Hant-TW")} 萬`; }
function rankColor(index: number, total: number): string { const position = total <= 1 ? 0 : index / (total - 1); const from = position <= 0.5 ? [90, 97, 72] : [155, 106, 67]; const to = position <= 0.5 ? [155, 106, 67] : [107, 75, 52]; const amount = position <= 0.5 ? position * 2 : (position - 0.5) * 2; return `rgb(${from.map((value, i) => Math.round(value + ((to[i] ?? value) - value) * amount)).join(", ")})`; }
function addArrayFilter(where: string[], values: unknown[], column: string, items: string[], excluded: boolean) { if (items.length) { values.push(items); where.push(`${column} ${excluded ? "<> ALL" : "= ANY"}($${values.length}::text[])`); } }
function addCoreNumberFilter(where: string[], values: unknown[], column: string, operator: string, value: number | undefined, key: string) { if (value !== undefined) { values.push(value); where.push(`${column} ${operator} $${values.length}`); where.push(`NOT (COALESCE(details->'_missingCore', '[]'::jsonb) ? '${key}')`); } }
function addBooleanFilter(where: string[], values: unknown[], column: string, value: unknown) { if (value === true) where.push(`${column} = true`); }
function addFeatureNumberFilter(where: string[], values: unknown[], key: string, value?: number) { if (value !== undefined) { values.push(value); where.push(`(features->>'${key}')::double precision <= $${values.length}`); } }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.replace(/台/g, "臺")) : []; }
function numberValue(value: unknown): number | undefined { if (typeof value === "number" && Number.isFinite(value)) return value; if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value); return undefined; }
function parseNear(value: unknown): { lat: number; lng: number; radiusKm: number } | null { if (!value || typeof value !== "object") return null; const row = value as Record<string, unknown>; const lat = numberValue(row.lat); const lng = numberValue(row.lng); const radiusKm = numberValue(row.radiusKm); return lat !== undefined && lng !== undefined && radiusKm !== undefined ? { lat, lng, radiusKm } : null; }
function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
function isMissingRelation(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && (error as { code: string }).code === "42P01"); }

const REGION_CITIES: Record<string, string[]> = {
  北部: ["臺北市", "新北市", "基隆市", "桃園市", "新竹市", "新竹縣", "宜蘭縣"],
  中部: ["臺中市", "苗栗縣", "彰化縣", "南投縣", "雲林縣"],
  南部: ["高雄市", "臺南市", "嘉義市", "嘉義縣", "屏東縣"],
  東部: ["花蓮縣", "臺東縣"],
  離島: ["澎湖縣", "金門縣", "連江縣"],
};
