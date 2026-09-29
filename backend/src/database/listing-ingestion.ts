import { createHash } from "node:crypto";
import pg from "pg";
import { z } from "zod";
import type { DetailExtractor } from "../details/extractor.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { vectorLiteral } from "../embeddings/provider.js";

const { Pool } = pg;

export const ingestListingSchema = z.object({
  id: z.string().min(1), source: z.string().min(1), sourceId: z.string().min(1), mode: z.enum(["sale", "rent"]),
  url: z.string(), title: z.string().min(1), description: z.string().default(""), scrapedAt: z.number().nonnegative(),
  city: z.string().min(1), district: z.string().min(1), address: z.string(), lat: z.number(), lng: z.number(),
  geocodeSource: z.enum(["nominatim", "district_derived", "city_derived", "district_reference", "city_reference", "provided"]).default("provided"),
  geocodePrecision: z.enum(["exact", "approximate", "unknown"]).default("unknown"),
  geocodeMatchedAddress: z.string().nullable().default(null),
  price: z.number().nonnegative(), unitPrice: z.number().nonnegative(), area: z.number().nonnegative(), layout: z.string(),
  rooms: z.number().int().nonnegative(), floor: z.number().int(), totalFloor: z.number().int().nonnegative(), age: z.number().nonnegative(),
  buildingType: z.string(), hasElevator: z.boolean(), hasParking: z.boolean(),
  details: z.record(z.string(), z.unknown()).default({}), features: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])).default({}),
  facts: z.array(z.object({
    key: z.string().min(1), label: z.string().min(1), group: z.string().min(1), value: z.unknown(), displayValue: z.string().optional(),
    unit: z.string().optional(), sourceName: z.string().optional(), sourceUrl: z.string().url().optional(), observedAt: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(), evidence: z.string().optional(),
  })).default([]),
});

export type IngestListing = z.infer<typeof ingestListingSchema>;
export type ListingFact = IngestListing["facts"][number] & { displayValue: string };

export interface ListingIngestion {
  ingest(runId: string, items: IngestListing[], signal?: AbortSignal): Promise<{ received: number; updated: number; skipped: number }>;
  complete(runId: string, source: string): Promise<{ deleted: number }>;
  close(): Promise<void>;
}

export function createListingIngestion(options: { databaseUrl: string; embeddings: EmbeddingProvider; details: DetailExtractor }): ListingIngestion {
  const pool = new Pool({ connectionString: options.databaseUrl });
  return {
    async ingest(runId, rawItems, signal) {
      const items = rawItems.map((item) => ingestListingSchema.parse(item));
      let updated = 0;
      let skipped = 0;
      for (const item of items) {
        const sourceHash = hash({ ...item, details: item.details, embeddingModel: options.embeddings.model, detailModel: options.details.model });
        const existing = await pool.query<{ source_hash: string }>("SELECT source_hash FROM listings WHERE id = $1", [item.id]);
        if (existing.rows[0]?.source_hash === sourceHash) {
          await pool.query("UPDATE listings SET ingest_run_id = $2 WHERE id = $1", [item.id, runId]);
          skipped += 1;
          continue;
        }
        const extracted = item.source === "seed" || item.facts.length > 0 || item.description.trim().length < 12 ? { facts: [] } : await options.details.extract(`${item.title}\n${item.description}`, signal);
        const details = item.details;
        const facts = buildFacts(item, details, extracted.facts);
        const semanticText = buildSemanticText(item, facts);
        const embedding = await options.embeddings.embed(semanticText, signal);
        const contentHash = hash({ sourceHash, details, semanticText });
        await pool.query({
          text: `INSERT INTO listings (id, source, source_id, mode, url, title, description, scraped_at, city, district, address, lat, lng, geocode_source, geocode_precision, geocode_matched_address, price, unit_price, area, layout, rooms, floor, total_floor, age, building_type, has_elevator, has_parking, details, features, facts, semantic_text, embedding, embedding_model, detail_extraction_model, content_hash, source_hash, ingest_run_id, indexed_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8 / 1000.0),$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28::jsonb,$29::jsonb,$30::jsonb,$31,$32::vector,$33,$34,$35,$36,$37,now())
            ON CONFLICT (id) DO UPDATE SET source=excluded.source, source_id=excluded.source_id, mode=excluded.mode, url=excluded.url, title=excluded.title, description=excluded.description, scraped_at=excluded.scraped_at, city=excluded.city, district=excluded.district, address=excluded.address, lat=excluded.lat, lng=excluded.lng, geocode_source=excluded.geocode_source, geocode_precision=excluded.geocode_precision, geocode_matched_address=excluded.geocode_matched_address, price=excluded.price, unit_price=excluded.unit_price, area=excluded.area, layout=excluded.layout, rooms=excluded.rooms, floor=excluded.floor, total_floor=excluded.total_floor, age=excluded.age, building_type=excluded.building_type, has_elevator=excluded.has_elevator, has_parking=excluded.has_parking, details=excluded.details, features=excluded.features, facts=excluded.facts, semantic_text=excluded.semantic_text, embedding=excluded.embedding, embedding_model=excluded.embedding_model, detail_extraction_model=excluded.detail_extraction_model, content_hash=excluded.content_hash, source_hash=excluded.source_hash, ingest_run_id=excluded.ingest_run_id, indexed_at=now()`,
          values: [item.id, item.source, item.sourceId, item.mode, item.url, item.title, item.description, item.scrapedAt, item.city, item.district, item.address, item.lat, item.lng, item.geocodeSource, item.geocodePrecision, item.geocodeMatchedAddress, item.price, item.unitPrice, item.area, item.layout, item.rooms, item.floor, item.totalFloor, item.age, item.buildingType, item.hasElevator, item.hasParking, JSON.stringify(details), JSON.stringify(item.features), JSON.stringify(facts), semanticText, vectorLiteral(embedding), options.embeddings.model, options.details.model, contentHash, sourceHash, runId],
          ...(signal ? { signal } : {}),
        });
        updated += 1;
      }
      return { received: items.length, updated, skipped };
    },
    async complete(runId, source) {
      const result = await pool.query("DELETE FROM listings WHERE source = $1 AND ingest_run_id IS DISTINCT FROM $2", [source, runId]);
      const seed = source === "seed" ? { rowCount: 0 } : await pool.query("DELETE FROM listings WHERE source = 'seed'");
      return { deleted: (result.rowCount ?? 0) + (seed.rowCount ?? 0) };
    },
    async close() { await pool.end(); },
  };
}

function buildFacts(item: IngestListing, details: Record<string, unknown>, extracted: ExtractedFact[]): ListingFact[] {
  const generated = Object.entries({ ...item.features, ...details })
    .filter(([key, value]) => !key.startsWith("_") && key !== "evidence" && value !== null && value !== undefined && value !== "")
    .map(([key, value]) => ({ key, label: LABELS[key] ?? humanize(key), group: GROUPS[key] ?? "其他", value, displayValue: displayValue(key, value) }));
  const merged = new Map<string, ListingFact>();
  for (const fact of [...generated, ...extracted, ...item.facts]) merged.set(fact.key, { ...fact, displayValue: fact.displayValue ?? displayValue(fact.key, fact.value) });
  return [...merged.values()];
}

function buildSemanticText(item: IngestListing, facts: ListingFact[]): string {
  return [item.title, item.description, `${item.city}${item.district}`, item.address, ...facts.map((fact) => `${fact.label}:${fact.displayValue}`)].filter(Boolean).join("；");
}

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
const LABELS: Record<string, string> = { distToMetro: "捷運距離", distToTrain: "火車站距離", distToBus: "公車站距離", commuteToCbdMin: "通勤時間", poiConvenience500: "附近超商", poiSupermarket500: "附近超市", poiSchool500: "附近學校", poiHospital1k: "附近醫院", poiPark500: "附近公園", poiRestaurant500: "附近餐廳", annualTemp: "年均溫", summerTemp: "夏季均溫", winterTemp: "冬季均溫", annualRainfall: "年雨量", rainDays: "年雨日", humidity: "相對濕度", sunHours: "年日照時數", aqiMean: "平均空氣品質", floodIncidents500: "附近淹水紀錄", liquefactionLevel: "土壤液化", orientation: "座向", daylightScore: "採光", ventilationScore: "通風", noiseScore: "安靜程度", hasBalcony: "陽台", hasDoorman: "管理員", renovation: "裝潢", evidence: "描述證據" };
const GROUPS: Record<string, string> = { distToMetro: "交通", distToTrain: "交通", distToBus: "交通", commuteToCbdMin: "交通", annualTemp: "氣候", summerTemp: "氣候", winterTemp: "氣候", annualRainfall: "氣候", rainDays: "氣候", humidity: "氣候", sunHours: "氣候", aqiMean: "環境", floodIncidents500: "災害風險", liquefactionLevel: "災害風險", orientation: "物件條件", daylightScore: "物件條件", ventilationScore: "物件條件", noiseScore: "物件條件", hasBalcony: "物件條件", hasDoorman: "物件條件", renovation: "物件條件" };
const UNITS: Record<string, string> = { distToMetro: "公尺", distToTrain: "公尺", distToBus: "公尺", commuteToCbdMin: "分鐘", annualTemp: "°C", summerTemp: "°C", winterTemp: "°C", annualRainfall: "毫米", rainDays: "天", humidity: "%", sunHours: "小時", floodIncidents500: "次" };

function displayValue(key: string, value: unknown): string {
  if (typeof value === "boolean") return value ? "有" : "無";
  const text = Array.isArray(value) ? value.join("、") : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `${text}${UNITS[key] ? ` ${UNITS[key]}` : ""}`;
}

function humanize(key: string): string { return key.replace(/([A-Z])/g, " $1").trim(); }

type ExtractedFact = Awaited<ReturnType<DetailExtractor["extract"]>>["facts"][number];
