import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadConfig } from "../config/env.js";
import { createListingIngestion, type IngestListing, type ListingFact } from "../database/listing-ingestion.js";
import { createEmbeddingProvider } from "../embeddings/provider.js";
import { fetchCurrentLvr, type LvrRecord } from "../pipeline/lvr-source.js";

const { Pool } = pg;
const SOURCE = "moi-lvr";
const SOURCE_NAME = "內政部實價登錄";
const SOURCE_URL = "https://plvr.land.moi.gov.tw/DownloadOpenData";
const CORE_KEYS = new Set(["listingName", "transactionMode", "city", "district", "price", "unitPrice", "area", "layout", "rooms", "floor", "totalFloor", "age", "buildingType", "hasElevator", "hasParking", "transactedAt", "note"]);

type Existing = {
  source_id: string;
  address: string;
  lat: number;
  lng: number;
  geocode_source: IngestListing["geocodeSource"];
  geocode_precision: IngestListing["geocodePrecision"];
  geocode_matched_address: string | null;
  facts: ListingFact[];
};

type Point = { lat: number; lng: number };

const CITY_CENTROIDS: Record<string, Point> = {
  "臺北市": { lat: 25.0375, lng: 121.5637 }, "新北市": { lat: 25.0169, lng: 121.4627 }, "基隆市": { lat: 25.1276, lng: 121.7392 },
  "桃園市": { lat: 24.9937, lng: 121.3010 }, "新竹市": { lat: 24.8138, lng: 120.9675 }, "新竹縣": { lat: 24.8387, lng: 121.0177 },
  "苗栗縣": { lat: 24.5602, lng: 120.8214 }, "臺中市": { lat: 24.1477, lng: 120.6736 }, "彰化縣": { lat: 24.0518, lng: 120.5161 },
  "南投縣": { lat: 23.9609, lng: 120.9719 }, "雲林縣": { lat: 23.7092, lng: 120.4313 }, "嘉義市": { lat: 23.4801, lng: 120.4491 },
  "嘉義縣": { lat: 23.4518, lng: 120.2555 }, "臺南市": { lat: 22.9999, lng: 120.2269 }, "高雄市": { lat: 22.6273, lng: 120.3014 },
  "屏東縣": { lat: 22.5519, lng: 120.5487 }, "宜蘭縣": { lat: 24.7021, lng: 121.7378 }, "花蓮縣": { lat: 23.9871, lng: 121.6015 },
  "臺東縣": { lat: 22.7583, lng: 121.1444 }, "澎湖縣": { lat: 23.5712, lng: 119.5664 }, "金門縣": { lat: 24.4493, lng: 118.3767 },
  "連江縣": { lat: 26.1608, lng: 119.9509 },
};

async function main(): Promise<void> {
  const config = loadConfig();
  const cacheDirectory = process.env.PIPELINE_CACHE_DIR ?? "/tmp/devjam-pipeline-cache";
  const maxAgeHours = Number(process.env.LVR_CACHE_MAX_AGE_HOURS ?? "12");
  const dataset = await fetchCurrentLvr(cacheDirectory, Math.max(0, maxAgeHours) * 3_600_000);
  if (!dataset.records.length) throw new Error("實價登錄沒有解析出任何住宅資料，不覆寫現有物件");

  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const existingResult = await pool.query<Existing>(
    "SELECT source_id, address, lat, lng, geocode_source, geocode_precision, geocode_matched_address, facts FROM listings WHERE source=$1",
    [SOURCE],
  );
  const existingById = new Map(existingResult.rows.map((row) => [row.source_id, row]));
  const districtCentroids = centroids(existingResult.rows, true);
  const cityCentroids = centroids(existingResult.rows, false);
  const observedAt = new Date(dataset.fetchedAt).toISOString();
  const embeddings = createEmbeddingProvider({
    mode: config.EMBEDDING_MODE,
    baseUrl: config.EMBEDDING_BASE_URL,
    ...(config.EMBEDDING_API_KEY ? { apiKey: config.EMBEDDING_API_KEY } : {}),
    model: config.EMBEDDING_MODEL,
    dimensions: config.EMBEDDING_DIMENSIONS,
  });
  const ingestion = createListingIngestion({ databaseUrl: config.DATABASE_URL, embeddings });
  const runId = randomUUID();
  let updated = 0;
  let skipped = 0;
  try {
    for (let index = 0; index < dataset.records.length; index += 50) {
      const items = dataset.records.slice(index, index + 50).map((record) => toListing(record, observedAt, dataset.fetchedAt, existingById.get(record.serial), districtCentroids, cityCentroids));
      const result = await ingestion.ingest(runId, items);
      updated += result.updated;
      skipped += result.skipped;
      if (index % 500 === 0) console.log(`lvr: ${Math.min(index + 50, dataset.records.length)}/${dataset.records.length}`);
    }
    const completion = await ingestion.complete(runId, SOURCE);
    console.log(JSON.stringify({ source: SOURCE, received: dataset.records.length, updated, skipped, deleted: completion.deleted, fetchedAt: observedAt }));
  } finally {
    await ingestion.close();
    await pool.end();
  }
}

function toListing(record: LvrRecord, observedAt: string, scrapedAt: number, existing: Existing | undefined, districts: Map<string, Point>, cities: Map<string, Point>): IngestListing {
  const location = existing
    ? { lat: Number(existing.lat), lng: Number(existing.lng), source: existing.geocode_source, precision: existing.geocode_precision, matchedAddress: existing.geocode_matched_address }
    : approximateLocation(record, districts, cities);
  const retained = (existing?.facts ?? []).filter((fact) => !CORE_KEYS.has(fact.key));
  const facts = [...retained, ...coreFacts(record, observedAt)];
  return {
    id: `lvr-${record.mode}-${record.serial}`,
    source: SOURCE,
    sourceId: record.serial,
    url: SOURCE_URL,
    scrapedAt,
    address: record.address,
    lat: location.lat,
    lng: location.lng,
    geocodeSource: location.source,
    geocodePrecision: location.precision,
    geocodeMatchedAddress: location.matchedAddress,
    extractionModel: "moi-lvr-parser-v2",
    facts,
  };
}

function coreFacts(record: LvrRecord, observedAt: string): ListingFact[] {
  const fact = (key: string, label: string, group: string, value: unknown, displayValue: string, unit?: string): ListingFact => ({
    key, label, group, value, displayValue, ...(unit ? { unit } : {}), sourceName: SOURCE_NAME, sourceUrl: SOURCE_URL, observedAt, confidence: 1, evidence: "內政部實價登錄開放資料",
  });
  const priceUnit = record.mode === "sale" ? "萬元" : "元/月";
  const unitPriceUnit = record.mode === "sale" ? "萬元/坪" : "元/坪";
  const facts = [
    fact("listingName", "物件名稱", "基本資料", `${record.district}${record.buildingType} ${record.area}坪`, `${record.district}${record.buildingType} ${record.area}坪`),
    fact("transactionMode", "交易類型", "交易", record.mode, record.mode === "sale" ? "買賣" : "租賃"),
    fact("city", "縣市", "位置", record.city, record.city), fact("district", "行政區", "位置", record.district, record.district),
    fact("price", "總價", "價格", record.price, `${record.price} ${priceUnit}`, priceUnit),
    fact("unitPrice", "單價", "價格", record.unitPrice, `${record.unitPrice} ${unitPriceUnit}`, unitPriceUnit),
    fact("area", "坪數", "格局", record.area, `${record.area} 坪`, "坪"), fact("layout", "格局", "格局", record.layout, record.layout),
    fact("rooms", "房數", "格局", record.rooms, `${record.rooms} 房`, "房"), fact("floor", "所在樓層", "格局", record.floor, `${record.floor} 樓`, "樓"),
    fact("totalFloor", "總樓層", "格局", record.totalFloor, `${record.totalFloor} 樓`, "樓"), fact("age", "屋齡", "建物", record.age, `${record.age} 年`, "年"),
    fact("buildingType", "建物型態", "建物", record.buildingType, record.buildingType),
    fact("hasElevator", "電梯", "建物", record.hasElevator, record.hasElevator ? "有" : "無"), fact("hasParking", "車位", "建物", record.hasParking, record.hasParking ? "有" : "無"),
  ];
  if (record.transactedAt) facts.push(fact("transactedAt", "交易日期", "交易", record.transactedAt, record.transactedAt));
  if (record.note) facts.push(fact("note", "備註", "其他", record.note, record.note));
  return facts;
}

function centroids(rows: Existing[], includeDistrict: boolean): Map<string, Point> {
  const sums = new Map<string, { lat: number; lng: number; count: number }>();
  for (const row of rows) {
    const city = factText(row.facts, "city");
    const district = factText(row.facts, "district");
    const key = includeDistrict ? (city && district ? `${city}|${district}` : "") : city;
    if (!key) continue;
    const current = sums.get(key) ?? { lat: 0, lng: 0, count: 0 };
    current.lat += Number(row.lat); current.lng += Number(row.lng); current.count += 1;
    sums.set(key, current);
  }
  return new Map([...sums].map(([key, value]) => [key, { lat: value.lat / value.count, lng: value.lng / value.count }]));
}

function approximateLocation(record: LvrRecord, districts: Map<string, Point>, cities: Map<string, Point>) {
  const center = districts.get(`${record.city}|${record.district}`) ?? cities.get(record.city) ?? CITY_CENTROIDS[record.city];
  if (!center) throw new Error(`找不到 ${record.city}${record.district} 的參考座標`);
  const point = jitter(center, record.address);
  return { ...point, source: (districts.has(`${record.city}|${record.district}`) ? "district_derived" : "city_derived") as IngestListing["geocodeSource"], precision: "approximate" as const, matchedAddress: null };
}

function jitter(center: Point, address: string): Point {
  let hash = 2_166_136_261;
  for (const character of address) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16_777_619); }
  const lat = ((hash >>> 0) % 10_000) / 10_000;
  const lng = ((Math.imul(hash, 31) >>> 0) % 10_000) / 10_000;
  return { lat: center.lat + (lat - 0.5) * 0.012, lng: center.lng + (lng - 0.5) * 0.012 };
}

function factText(facts: ListingFact[], key: string): string {
  const value = facts.find((fact) => fact.key === key)?.value;
  return typeof value === "string" ? value : "";
}

await main();
