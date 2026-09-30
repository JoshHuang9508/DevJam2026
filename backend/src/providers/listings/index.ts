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
  source: { id: string; itemId: string; url: string };
  location: { address: string; lat: number; lng: number };
  facts: ListingFact[];
  assessment: CandidateAssessment;
  view: ListingView;
}

export interface ListingView {
  title: string;
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
  url: string;
  address: string;
  lat: number;
  lng: number;
  facts: ListingFact[];
  semantic_score: number;
}

export class ListingsUnavailableError extends Error {}

export function createListingsProvider(options: { databaseUrl: string; embeddings: EmbeddingProvider; evaluator: ListingEvaluator }): ListingsProvider {
  const pool = new Pool({ connectionString: options.databaseUrl });

  const search = async (profile: SearchProfile, semanticQuery = "", limit = 20, signal?: AbortSignal): Promise<RankListingsResult> => {
    try {
      const query = semanticQuery.trim() || profile.notes?.join(" ").trim() || "根據所有已知資料找出最適合的物件";
      const vector = await options.embeddings.embed(query, signal);
      const values: unknown[] = [];
      const where: string[] = [];
      addFactTextFilter(where, values, "transactionMode", [profile.mode], false);
      applyHardFilters(where, values, profile.hard);
      values.push(vectorLiteral(vector));
      const vectorRef = `$${values.length}::vector`;
      where.push("embedding IS NOT NULL");
      const requested = Math.min(Math.max(limit, 1), 30);
      values.push(Math.min(Math.max(requested * 2, 20), 40));
      const rows = (await pool.query<ListingRow>({
        text: `SELECT id, source, source_id, url, address, lat, lng, facts, 1 - (embedding <=> ${vectorRef}) AS semantic_score FROM listings WHERE ${where.join(" AND ")} ORDER BY embedding <=> ${vectorRef} LIMIT $${values.length}`,
        values,
        ...(signal ? { signal } : {}),
      })).rows;
      if (rows.length === 0) return { mode: profile.mode, total: 0, relaxations: ["必要條件沒有符合的物件，條件未自動放寬。"], criteria: [], listings: [], results: [], effectiveProfile: profile };
      const candidates = rows.map(toAssessmentCandidate);
      const evaluated = await options.evaluator.evaluate(query, candidates, signal);
      const ordered = rows
        .map((row) => ({ row, assessment: evaluated.assessments.get(row.id) ?? semanticAssessment(row) }))
        .sort((a, b) => b.assessment.score - a.assessment.score || b.assessment.confidence - a.assessment.confidence)
        .slice(0, requested);
      const results = ordered.map((item, index, all) => toSearchResult(item.row, item.assessment, index, all.length));
      return { mode: profile.mode, total: results.length, relaxations: [], criteria: evaluated.criteria, listings: results.slice(0, 20).map(project), results, effectiveProfile: profile };
    } catch (error) {
      if (isMissingRelation(error)) throw new ListingsUnavailableError("物件資料庫尚未建立，請先執行資料管線");
      throw error;
    }
  };

  const rowsForMode = async (mode: Mode, signal?: AbortSignal): Promise<ListingRow[]> => {
    const result = await pool.query<ListingRow>({
      text: "SELECT id, source, source_id, url, address, lat, lng, facts, 0.5::double precision AS semantic_score FROM listings WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(facts) fact WHERE fact->>'key'='transactionMode' AND fact->>'value'=$1)",
      values: [mode],
      ...(signal ? { signal } : {}),
    });
    return result.rows;
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
      const rows = await rowsForMode(mode, signal);
      const groups = new Map<string, { city: string; district: string; count: number; prices: number[]; areas: number[] }>();
      for (const row of rows) {
        const city = factString(row.facts, "city") ?? "未知";
        const district = factString(row.facts, "district") ?? "未知";
        const key = `${city}\u0000${district}`;
        const group = groups.get(key) ?? { city, district, count: 0, prices: [], areas: [] };
        group.count += 1;
        const price = factNumber(row.facts, "price");
        const area = factNumber(row.facts, "area");
        if (price !== undefined) group.prices.push(price);
        if (area !== undefined) group.areas.push(area);
        groups.set(key, group);
      }
      const districts = [...groups.values()].map((group) => ({ city: group.city, district: group.district, count: group.count, medianPrice: median(group.prices), medianArea: median(group.areas) }));
      return { mode, total: rows.length, cities: [...new Set(districts.map((row) => row.city))], districts, priceUnit: mode === "rent" ? "元/月" : "萬元", source: "PostgreSQL listing facts" };
    },
    async rows(mode) {
      return (await rowsForMode(mode)).map((row) => ({ city: factString(row.facts, "city") ?? "", district: factString(row.facts, "district") ?? "", price: factNumber(row.facts, "price") ?? 0, area: factNumber(row.facts, "area") ?? 0 }));
    },
    async districts() {
      const rows = (await pool.query<ListingRow>("SELECT id, source, source_id, url, address, lat, lng, facts, 0.5::double precision AS semantic_score FROM listings")).rows;
      const groups = new Map<string, { city: string; name: string; lat: number; lng: number; count: number }>();
      for (const row of rows) {
        const city = factString(row.facts, "city") ?? "";
        const name = factString(row.facts, "district") ?? "";
        if (!city || !name) continue;
        const key = `${city}\u0000${name}`;
        const group = groups.get(key) ?? { city, name, lat: 0, lng: 0, count: 0 };
        group.lat += Number(row.lat);
        group.lng += Number(row.lng);
        group.count += 1;
        groups.set(key, group);
      }
      return [...groups.values()].map((group) => ({ city: group.city, name: group.name, lat: group.lat / group.count, lng: group.lng / group.count, listing_count: group.count }));
    },
    async close() { await pool.end(); },
    search,
  };
}

function profileFromPreferences(preferences: PreferenceState, mode: Mode): SearchProfile {
  const hard = preferences.hardConstraints;
  return { mode, hard: { regions: hard.regions, cities: hard.cities, districts: hard.districts, excludedCities: hard.excludedCities, excludedDistricts: hard.excludedDistricts, budgetMin: mode === "sale" ? hard.minTotalPriceWan : hard.minMonthlyRent, budgetMax: mode === "sale" ? hard.maxTotalPriceWan : hard.maxMonthlyRent, minArea: hard.minArea, minRooms: hard.minRooms, maxAge: hard.maxAge, buildingTypes: hard.buildingTypes, needElevator: hard.needElevator, needParking: hard.needParking, maxDistToMetro: hard.maxWalkMinutesToMetro === undefined ? undefined : hard.maxWalkMinutesToMetro * 80, maxCommuteMinutes: hard.maxCommuteMinutes } };
}

function toAssessmentCandidate(row: ListingRow): AssessmentCandidate {
  const title = listingTitle(row);
  return { id: row.id, title, address: row.address, source: row.source, semanticScore: clamp(Number(row.semantic_score ?? 0.5)), facts: row.facts.map((fact) => ({ key: fact.key, label: fact.label, value: fact.value, displayValue: fact.displayValue, ...(fact.confidence === undefined ? {} : { confidence: fact.confidence }), ...(fact.evidence ? { evidence: fact.evidence.slice(0, 240) } : {}) })) };
}

function toSearchResult(row: ListingRow, assessment: CandidateAssessment, index: number, total: number): SearchResult {
  const title = listingTitle(row);
  const matched = assessment.matchedFactKeys.map((key) => row.facts.find((fact) => fact.key === key)).filter((fact): fact is ListingFact => Boolean(fact));
  const cardFacts = [...matched, ...row.facts.filter((fact) => !assessment.matchedFactKeys.includes(fact.key) && !["listingName", "description"].includes(fact.key))].slice(0, 6).map(toViewFact);
  return {
    id: row.id,
    source: { id: row.source, itemId: row.source_id, url: row.url },
    location: { address: row.address, lat: Number(row.lat), lng: Number(row.lng) },
    facts: row.facts,
    assessment,
    view: {
      title,
      rankLabel: `第 ${index + 1} 名`,
      locationLabel: row.address,
      cardFacts,
      detailFacts: [
        { key: "address", label: "地址", value: row.address, wide: true, group: "位置" },
        { key: "coordinates", label: "座標", value: `${Number(row.lat).toFixed(6)}, ${Number(row.lng).toFixed(6)}`, wide: true, group: "位置" },
        { key: "source", label: "來源", value: row.source, wide: false, group: "來源" },
        ...row.facts.filter((fact) => fact.key !== "listingName").map((fact) => ({ ...toViewFact(fact), group: fact.group })),
      ],
      marker: { label: String(index + 1), title: `${title}｜匹配 ${assessment.score} 分`, color: rankColor(index, total), size: index < 3 ? 38 : 32, zIndex: total - index },
      action: row.url ? { label: "查看原始物件 ↗", url: row.url } : null,
    },
  };
}

function semanticAssessment(row: ListingRow): CandidateAssessment {
  const score = Math.round(clamp(Number(row.semantic_score ?? 0.5)) * 100);
  return { score, starsText: (score / 20).toFixed(1), confidence: 0.35, summary: "依目前可讀取資料與搜尋需求的語意相符程度排序。", strengths: [], tradeoffs: [], matchedFactKeys: [], missingInformation: [] };
}

function project(result: SearchResult): RankedListing {
  const cited = new Set(result.assessment.matchedFactKeys);
  return { id: result.id, title: result.view.title, source: result.source.id, url: result.source.url, address: result.location.address, lat: result.location.lat, lng: result.location.lng, score: result.assessment.score, confidence: result.assessment.confidence, summary: result.assessment.summary, strengths: result.assessment.strengths, tradeoffs: result.assessment.tradeoffs, missingInformation: result.assessment.missingInformation, facts: result.facts.filter((fact) => !cited.size || cited.has(fact.key)).slice(0, 20).map((fact) => ({ label: fact.label, value: fact.displayValue, ...(fact.evidence ? { evidence: fact.evidence } : {}) })) };
}

function applyHardFilters(where: string[], values: unknown[], hard: Record<string, unknown>): void {
  const selectedCities = stringArray(hard.cities);
  const regionCities = stringArray(hard.regions).flatMap((region) => REGION_CITIES[region] ?? []);
  const cities = selectedCities.length && regionCities.length ? selectedCities.filter((city) => regionCities.includes(city)) : selectedCities.length ? selectedCities : regionCities;
  addFactTextFilter(where, values, "city", cities, false);
  addFactTextFilter(where, values, "district", stringArray(hard.districts), false);
  addFactTextFilter(where, values, "city", stringArray(hard.excludedCities), true);
  addFactTextFilter(where, values, "district", stringArray(hard.excludedDistricts), true);
  addFactNumberFilter(where, values, "price", ">=", numberValue(hard.budgetMin));
  addFactNumberFilter(where, values, "price", "<=", numberValue(hard.budgetMax));
  addFactNumberFilter(where, values, "area", ">=", numberValue(hard.minArea));
  addFactNumberFilter(where, values, "rooms", ">=", numberValue(hard.minRooms));
  addFactNumberFilter(where, values, "age", "<=", numberValue(hard.maxAge));
  addFactBooleanFilter(where, values, "hasElevator", hard.needElevator);
  addFactBooleanFilter(where, values, "hasParking", hard.needParking);
  addFactLikeFilter(where, values, "buildingType", stringArray(hard.buildingTypes));
  addFactNumberFilter(where, values, "distToMetro", "<=", numberValue(hard.maxDistToMetro));
  addFactNumberFilter(where, values, "commuteToCbdMin", "<=", numberValue(hard.maxCommuteMinutes));
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
  const result = await pool.query<ListingRow>("SELECT id, source, source_id, url, address, lat, lng, facts, 0.5::double precision AS semantic_score FROM listings WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(facts) fact WHERE fact->>'key' IN ('city','district') AND fact->>'value' ILIKE $1) LIMIT 200", [`%${normalized}%`]);
  if (!result.rows.length) return null;
  const lat = result.rows.reduce((sum, row) => sum + Number(row.lat), 0) / result.rows.length;
  const lng = result.rows.reduce((sum, row) => sum + Number(row.lng), 0) / result.rows.length;
  const first = result.rows[0]!;
  return { lat, lng, radiusKm: radiusKm ?? 5, label: `${factString(first.facts, "city") ?? ""}${factString(first.facts, "district") ?? normalized}` };
}

function addFactTextFilter(where: string[], values: unknown[], key: string, items: string[], excluded: boolean): void {
  if (!items.length) return;
  values.push(key, items.map((item) => item.replace(/台/g, "臺")));
  const exists = `EXISTS (SELECT 1 FROM jsonb_array_elements(facts) fact WHERE fact->>'key' = $${values.length - 1} AND fact->>'value' = ANY($${values.length}::text[]))`;
  where.push(excluded ? `NOT ${exists}` : exists);
}

function addFactNumberFilter(where: string[], values: unknown[], key: string, operator: ">=" | "<=", value?: number): void {
  if (value === undefined) return;
  values.push(key, value);
  where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(facts) fact WHERE fact->>'key' = $${values.length - 1} AND jsonb_typeof(fact->'value') = 'number' AND (fact->>'value')::double precision ${operator} $${values.length}::double precision)`);
}

function addFactBooleanFilter(where: string[], values: unknown[], key: string, value: unknown): void {
  if (value !== true) return;
  values.push(key);
  where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(facts) fact WHERE fact->>'key' = $${values.length} AND fact->'value' = 'true'::jsonb)`);
}

function addFactLikeFilter(where: string[], values: unknown[], key: string, items: string[]): void {
  if (!items.length) return;
  values.push(key, items.map((item) => `%${item}%`));
  where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(facts) fact WHERE fact->>'key' = $${values.length - 1} AND fact->>'value' ILIKE ANY($${values.length}::text[]))`);
}

function listingTitle(row: ListingRow): string { return factString(row.facts, "listingName") ?? row.address; }
function toViewFact(fact: ListingFact) { return { key: fact.key, label: fact.label, value: fact.displayValue, wide: false }; }
function factString(facts: ListingFact[], key: string): string | undefined { const value = facts.find((fact) => fact.key === key)?.value; return typeof value === "string" ? value : undefined; }
function factNumber(facts: ListingFact[], key: string): number | undefined { const value = facts.find((fact) => fact.key === key)?.value; return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function median(values: number[]): number { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle]! : ((sorted[middle - 1] ?? 0) + sorted[middle]!) / 2; }
function rankColor(index: number, total: number): string { const position = total <= 1 ? 0 : index / (total - 1); const from = position <= 0.5 ? [90, 97, 72] : [155, 106, 67]; const to = position <= 0.5 ? [155, 106, 67] : [107, 75, 52]; const amount = position <= 0.5 ? position * 2 : (position - 0.5) * 2; return `rgb(${from.map((value, i) => Math.round(value + ((to[i] ?? value) - value) * amount)).join(", ")})`; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
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
