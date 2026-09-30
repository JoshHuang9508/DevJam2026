import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { z } from "zod";
import type { ListingIngestion, IngestListing, ListingFact } from "../database/listing-ingestion.js";
import type { EnrichmentService } from "../enrichment/service.js";
import type { GeocodingService } from "../geocoding/service.js";
import type { NormalizedListing, RawNormalizer } from "./normalizer.js";

const { Pool } = pg;

export const rawSourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().min(1),
  startUrl: z.string().url(),
  documentMode: z.enum(["single", "links", "json"]).default("single"),
  linkPattern: z.string().optional(),
  maxDocuments: z.number().int().min(1).max(100).default(20),
  defaultMode: z.enum(["sale", "rent"]).nullable().default(null),
  headers: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
  refreshMinutes: z.number().int().min(5).default(1440),
});

export type RawSourceInput = z.infer<typeof rawSourceSchema>;

export interface PipelineService {
  sources(): Promise<RawSourceInput[]>;
  saveSource(source: RawSourceInput): Promise<RawSourceInput>;
  jobs(limit: number): Promise<Array<Record<string, unknown>>>;
  run(input?: { sourceIds?: string[] | undefined }, signal?: AbortSignal): Promise<PipelineRunResult>;
  start(intervalMs: number): void;
  close(): Promise<void>;
}

export interface PipelineRunResult {
  jobId: string;
  sources: number;
  documents: number;
  listings: number;
  skipped: number;
  errors: Array<{ sourceId: string; url: string; message: string }>;
}

type SourceRow = {
  id: string;
  name: string;
  start_url: string;
  document_mode: RawSourceInput["documentMode"];
  link_pattern: string | null;
  max_documents: number;
  default_mode: "sale" | "rent" | null;
  headers: Record<string, string>;
  enabled: boolean;
  refresh_minutes: number;
};

export function createPipelineService(options: {
  databaseUrl: string;
  normalizer: RawNormalizer;
  geocoding: GeocodingService;
  ingestion: ListingIngestion;
  enrichment: EnrichmentService;
  fetchTimeoutMs?: number;
}): PipelineService {
  const pool = new Pool({ connectionString: options.databaseUrl });
  const fetchTimeoutMs = options.fetchTimeoutMs ?? 30_000;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<PipelineRunResult> | undefined;

  const run = async (input: { sourceIds?: string[] | undefined } = {}, signal?: AbortSignal): Promise<PipelineRunResult> => {
    if (running) return running;
    running = executeRun(pool, options, fetchTimeoutMs, input, signal).finally(() => { running = undefined; });
    return running;
  };

  return {
    async sources() {
      const result = await pool.query<SourceRow>("SELECT id, name, start_url, document_mode, link_pattern, max_documents, default_mode, headers, enabled, refresh_minutes FROM raw_sources ORDER BY name");
      return result.rows.map(toSource);
    },

    async saveSource(rawSource) {
      const source = rawSourceSchema.parse(rawSource);
      if (source.linkPattern) new RegExp(source.linkPattern);
      await pool.query(
        `INSERT INTO raw_sources (id, name, start_url, document_mode, link_pattern, max_documents, default_mode, headers, enabled, refresh_minutes, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,now())
         ON CONFLICT (id) DO UPDATE SET name=excluded.name, start_url=excluded.start_url, document_mode=excluded.document_mode, link_pattern=excluded.link_pattern, max_documents=excluded.max_documents, default_mode=excluded.default_mode, headers=excluded.headers, enabled=excluded.enabled, refresh_minutes=excluded.refresh_minutes, updated_at=now()`,
        [source.id, source.name, source.startUrl, source.documentMode, source.linkPattern ?? null, source.maxDocuments, source.defaultMode, JSON.stringify(source.headers), source.enabled, source.refreshMinutes],
      );
      return source;
    },

    async jobs(limit) {
      const result = await pool.query("SELECT id, status, summary, error, started_at, finished_at FROM ingestion_jobs ORDER BY started_at DESC LIMIT $1", [limit]);
      return result.rows;
    },

    run,

    start(intervalMs) {
      if (intervalMs <= 0 || timer) return;
      timer = setInterval(() => { void run().catch(() => undefined); }, intervalMs);
      timer.unref();
    },

    async close() {
      if (timer) clearInterval(timer);
      await running?.catch(() => undefined);
      await pool.end();
    },
  };
}

async function executeRun(
  pool: pg.Pool,
  options: { normalizer: RawNormalizer; geocoding: GeocodingService; ingestion: ListingIngestion; enrichment: EnrichmentService },
  timeoutMs: number,
  input: { sourceIds?: string[] | undefined },
  signal?: AbortSignal,
): Promise<PipelineRunResult> {
  const jobId = randomUUID();
  const result: PipelineRunResult = { jobId, sources: 0, documents: 0, listings: 0, skipped: 0, errors: [] };
  await pool.query("INSERT INTO ingestion_jobs (id, status, started_at) VALUES ($1, 'running', now())", [jobId]);
  try {
    const sources = await dueSources(pool, input.sourceIds);
    result.sources = sources.length;
    for (const source of sources) {
      try {
        const documents = await collectDocuments(source, timeoutMs, signal);
        result.documents += documents.length;
        const listingIds: string[] = [];
        for (const document of documents) {
          const documentResult = await processDocument(pool, options, jobId, source, document, signal);
          result.listings += documentResult.listingIds.length;
          result.skipped += documentResult.skipped;
          listingIds.push(...documentResult.listingIds);
          result.errors.push(...documentResult.errors);
        }
        if (listingIds.length) await options.enrichment.run({ listingIds, limit: Math.min(listingIds.length, 100) }, signal);
        await pool.query("UPDATE raw_sources SET last_run_at=now(), next_run_at=now() + refresh_minutes * interval '1 minute' WHERE id=$1", [source.id]);
      } catch (error) {
        result.errors.push({ sourceId: source.id, url: source.start_url, message: message(error) });
      }
    }
    const status = result.errors.length ? "completed_with_errors" : "completed";
    await pool.query("UPDATE ingestion_jobs SET status=$2, summary=$3::jsonb, finished_at=now() WHERE id=$1", [jobId, status, JSON.stringify(result)]);
    return result;
  } catch (error) {
    await pool.query("UPDATE ingestion_jobs SET status='failed', error=$2, finished_at=now() WHERE id=$1", [jobId, message(error)]);
    throw error;
  } finally {
    options.geocoding.complete(jobId);
  }
}

async function processDocument(
  pool: pg.Pool,
  options: { normalizer: RawNormalizer; geocoding: GeocodingService; ingestion: ListingIngestion },
  jobId: string,
  source: SourceRow,
  document: { url: string; contentType: string; content: string },
  signal?: AbortSignal,
): Promise<{ listingIds: string[]; skipped: number; errors: Array<{ sourceId: string; url: string; message: string }> }> {
  const contentHash = sha(document.content);
  const existing = await pool.query<{ id: string; status: string }>("SELECT id, status FROM raw_documents WHERE source_id=$1 AND url=$2 AND content_hash=$3 AND normalization_model=$4", [source.id, document.url, contentHash, options.normalizer.model]);
  if (existing.rows[0]?.status === "processed") return { listingIds: [], skipped: 1, errors: [] };
  const documentId = existing.rows[0]?.id ?? randomUUID();
  await pool.query(
    `INSERT INTO raw_documents (id, job_id, source_id, url, content_type, content, content_hash, normalization_model, status, fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'fetched',now())
     ON CONFLICT (source_id, url, content_hash, normalization_model) DO UPDATE SET job_id=excluded.job_id, status='fetched', error=NULL, fetched_at=now()`,
    [documentId, jobId, source.id, document.url, document.contentType, document.content, contentHash, options.normalizer.model],
  );
  try {
    const normalized = await options.normalizer.normalize({ sourceName: source.name, sourceUrl: document.url, content: readable(document.content, document.contentType) }, signal);
    await pool.query("UPDATE raw_documents SET normalized=$2::jsonb, status='normalized', normalized_at=now() WHERE id=$1", [documentId, JSON.stringify(normalized)]);
    const items: IngestListing[] = [];
    const errors: Array<{ sourceId: string; url: string; message: string }> = [];
    for (const listing of normalized) {
      if (!listing.address) {
        errors.push({ sourceId: source.id, url: listing.url ?? document.url, message: `缺少可定位地址：${factText(listing.facts, "listingName") ?? document.url}` });
        continue;
      }
      if (!factTransactionMode(listing.facts) && !source.default_mode) {
        errors.push({ sourceId: source.id, url: listing.url ?? document.url, message: `無法確認買賣或租賃：${factText(listing.facts, "listingName") ?? listing.address}` });
        continue;
      }
      const [point] = await options.geocoding.lookup(jobId, [listing.address], signal);
      if (!point) {
        errors.push({ sourceId: source.id, url: listing.url ?? document.url, message: `地址無法轉換座標：${listing.address}` });
        continue;
      }
      items.push(toIngestListing(source, document.url, listing, options.normalizer.model, point));
    }
    if (items.length) await options.ingestion.ingest(jobId, items, signal);
    await pool.query("UPDATE raw_documents SET status='processed', processed_at=now(), error=$2 WHERE id=$1", [documentId, errors.length ? errors.map((item) => item.message).join("；").slice(0, 2000) : null]);
    return { listingIds: items.map((item) => item.id), skipped: 0, errors };
  } catch (error) {
    const detail = message(error);
    await pool.query("UPDATE raw_documents SET status='failed', error=$2, processed_at=now() WHERE id=$1", [documentId, detail.slice(0, 2000)]);
    return { listingIds: [], skipped: 0, errors: [{ sourceId: source.id, url: document.url, message: detail }] };
  }
}

async function dueSources(pool: pg.Pool, ids?: string[]): Promise<SourceRow[]> {
  const result = ids?.length
    ? await pool.query<SourceRow>("SELECT * FROM raw_sources WHERE enabled AND id=ANY($1::text[]) ORDER BY name", [ids])
    : await pool.query<SourceRow>("SELECT * FROM raw_sources WHERE enabled AND (next_run_at IS NULL OR next_run_at <= now()) ORDER BY name");
  return result.rows;
}

async function collectDocuments(source: SourceRow, timeoutMs: number, signal?: AbortSignal): Promise<Array<{ url: string; contentType: string; content: string }>> {
  const index = await fetchDocument(source.start_url, source.headers, timeoutMs, signal);
  if (source.document_mode !== "links") return [index];
  const matcher = source.link_pattern ? new RegExp(source.link_pattern) : null;
  const urls = [...index.content.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)]
    .map((match) => new URL(match[1]!, source.start_url).href)
    .filter((url, index, all) => all.indexOf(url) === index && (!matcher || matcher.test(url)))
    .slice(0, source.max_documents);
  const documents: Array<{ url: string; contentType: string; content: string }> = [];
  for (const url of urls) documents.push(await fetchDocument(url, source.headers, timeoutMs, signal));
  return documents;
}

async function fetchDocument(url: string, headers: Record<string, string>, timeoutMs: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, { headers: { accept: "text/html,application/json,text/plain", ...headers }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new Error(`來源回應 ${response.status}`);
  return { url: response.url || url, contentType: response.headers.get("content-type") ?? "text/plain", content: (await response.text()).slice(0, 500_000) };
}

function toIngestListing(source: SourceRow, documentUrl: string, listing: NormalizedListing, extractionModel: string, point: NonNullable<Awaited<ReturnType<GeocodingService["lookup"]>>[number]>): IngestListing {
  const sourceId = listing.sourceId ?? sha(`${listing.url ?? documentUrl}|${listing.address}`).slice(0, 24);
  const observedAt = new Date().toISOString();
  const listingUrl = resolveUrl(listing.url, documentUrl);
  const location = parseLocation(listing.address!);
  const facts: ListingFact[] = listing.facts.map((fact) => {
    const value = normalizeFactValue(fact.key, fact.value);
    return { ...fact, value, displayValue: fact.displayValue ?? displayValue(value, fact.unit), sourceName: source.name, sourceUrl: listingUrl, observedAt };
  });
  if (source.default_mode && !factTransactionMode(facts)) facts.push(systemFact("transactionMode", "交易類型", "交易", source.default_mode, source.default_mode === "sale" ? "買賣" : "租賃", source, listingUrl, observedAt));
  if (location.city && !factText(facts, "city")) facts.push(systemFact("city", "縣市", "位置", location.city, location.city, source, listingUrl, observedAt));
  if (location.district && !factText(facts, "district")) facts.push(systemFact("district", "行政區", "位置", location.district, location.district, source, listingUrl, observedAt));
  return {
    id: `${source.id}:${sourceId}`,
    source: source.id,
    sourceId,
    url: listingUrl,
    scrapedAt: Date.now(),
    address: listing.address!,
    lat: point.lat,
    lng: point.lng,
    geocodeSource: point.source,
    geocodePrecision: point.precision,
    geocodeMatchedAddress: point.matchedAddress,
    extractionModel,
    facts,
  };
}

function parseLocation(rawAddress: string): { city: string; district: string } {
  const address = rawAddress.replace(/^\d{3,5}/, "");
  const matchedCity = address.match(/^(.+?[縣市])/)?.[1] ?? "";
  const city = matchedCity.replace(/台/g, "臺");
  const afterCity = matchedCity ? address.slice(matchedCity.length) : address;
  const district = afterCity.match(/^(.+?[區鄉鎮市])/)?.[1] ?? "";
  return { city, district };
}

function factText(facts: Array<{ key: string; value: unknown }>, key: string): string | undefined {
  const value = facts.find((fact) => fact.key === key)?.value;
  return typeof value === "string" ? value : undefined;
}

function factTransactionMode(facts: Array<{ key: string; value: unknown }>): "sale" | "rent" | undefined {
  const value = facts.find((fact) => fact.key === "transactionMode")?.value;
  const normalized = normalizeFactValue("transactionMode", value);
  return normalized === "sale" || normalized === "rent" ? normalized : undefined;
}

function systemFact(key: string, label: string, group: string, value: string, display: string, source: SourceRow, sourceUrl: string, observedAt: string): ListingFact {
  return { key, label, group, value, displayValue: display, sourceName: source.name, sourceUrl, observedAt, confidence: 1, evidence: "來源設定或地址解析" };
}

function displayValue(value: unknown, unit?: string): string {
  const text = Array.isArray(value) ? value.join("、") : String(value);
  return `${text}${unit ? ` ${unit}` : ""}`;
}

function normalizeFactValue(key: string, value: unknown): unknown {
  if (key === "city" && typeof value === "string") return value.replace(/台/g, "臺");
  if (key === "transactionMode" && typeof value === "string") {
    if (["sale", "買賣", "出售", "售屋"].includes(value)) return "sale";
    if (["rent", "租賃", "出租", "租屋"].includes(value)) return "rent";
  }
  if (["hasElevator", "hasParking"].includes(key) && typeof value === "string") {
    if (["true", "有", "是"].includes(value.toLowerCase())) return true;
    if (["false", "無", "否"].includes(value.toLowerCase())) return false;
  }
  return value;
}

function readable(content: string, contentType: string): string {
  if (contentType.includes("json") || contentType.includes("csv") || contentType.includes("plain")) return content.slice(0, 80_000);
  return content.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 80_000);
}

function toSource(row: SourceRow): RawSourceInput {
  return { id: row.id, name: row.name, startUrl: row.start_url, documentMode: row.document_mode, ...(row.link_pattern ? { linkPattern: row.link_pattern } : {}), maxDocuments: row.max_documents, defaultMode: row.default_mode, headers: row.headers ?? {}, enabled: row.enabled, refreshMinutes: row.refresh_minutes };
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveUrl(value: string | undefined, base: string): string {
  try { return value ? new URL(value, base).href : base; }
  catch { return base; }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
