import { createHash } from "node:crypto";
import pg from "pg";
import { z } from "zod";
import type { DetailExtractor } from "../details/extractor.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { vectorLiteral } from "../embeddings/provider.js";

const { Pool } = pg;

export const enrichmentSourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().min(1),
  urlTemplate: z.string().url(),
  scope: z.enum(["listing", "address", "district", "city"]),
  requires: z.array(z.string().min(1)).default([]),
  enabled: z.boolean().default(true),
});

export type EnrichmentSourceInput = z.infer<typeof enrichmentSourceSchema>;

export interface EnrichmentService {
  sources(): Promise<EnrichmentSourceInput[]>;
  saveSource(source: EnrichmentSourceInput): Promise<EnrichmentSourceInput>;
  run(input: { sourceIds?: string[] | undefined; listingIds?: string[] | undefined; limit: number }, signal?: AbortSignal): Promise<{ processed: number; updated: number; failed: Array<{ listingId: string; sourceId: string; message: string }> }>;
  close(): Promise<void>;
}

type ListingRow = {
  id: string;
  title: string;
  description: string;
  city: string;
  district: string;
  address: string;
  lat: number;
  lng: number;
  facts: unknown;
};

type SourceRow = {
  id: string;
  name: string;
  url_template: string;
  scope: EnrichmentSourceInput["scope"];
  requires: string[];
  enabled: boolean;
};

export function createEnrichmentService(options: { databaseUrl: string; embeddings: EmbeddingProvider; details: DetailExtractor; timeoutMs?: number }): EnrichmentService {
  const pool = new Pool({ connectionString: options.databaseUrl });
  const timeoutMs = options.timeoutMs ?? 20_000;

  return {
    async sources() {
      const result = await pool.query<SourceRow>("SELECT id, name, url_template, scope, requires, enabled FROM enrichment_sources ORDER BY name");
      return result.rows.map(toSource);
    },

    async saveSource(rawSource) {
      const source = enrichmentSourceSchema.parse(rawSource);
      await pool.query(
        `INSERT INTO enrichment_sources (id, name, url_template, scope, requires, enabled, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, now())
         ON CONFLICT (id) DO UPDATE SET name=excluded.name, url_template=excluded.url_template, scope=excluded.scope, requires=excluded.requires, enabled=excluded.enabled, updated_at=now()`,
        [source.id, source.name, source.urlTemplate, source.scope, JSON.stringify(source.requires), source.enabled],
      );
      return source;
    },

    async run(input, signal) {
      const listings = await loadListings(pool, input.listingIds, input.limit);
      const sources = await loadSources(pool, input.sourceIds);
      let updated = 0;
      let processed = 0;
      const failed: Array<{ listingId: string; sourceId: string; message: string }> = [];

      for (const listing of listings) {
        for (const source of sources) {
          if (!applicable(source, listing)) continue;
          processed += 1;
          const url = fillTemplate(source.url_template, listing);
          try {
            const page = await fetchPage(url, timeoutMs, signal);
            const extracted = await options.details.extract([
              `物件：${listing.title}`,
              `位置：${listing.city}${listing.district}${listing.address}`,
              `資料來源：${source.name}`,
              page,
            ].join("\n"), signal);
            const observedAt = new Date().toISOString();
            const sourceFacts = extracted.facts.map((fact) => ({ ...fact, sourceName: source.name, sourceUrl: url, observedAt }));
            const facts = mergeFacts(listing.facts, source.id, sourceFacts);
            const semanticText = buildSemanticText(listing, facts);
            const embedding = await options.embeddings.embed(semanticText, signal);
            const contentHash = createHash("sha256").update(JSON.stringify({ semanticText, facts })).digest("hex");
            await pool.query(
              `UPDATE listings SET facts=$2::jsonb, semantic_text=$3, embedding=$4::vector, embedding_model=$5, detail_extraction_model=$6, content_hash=$7, indexed_at=now() WHERE id=$1`,
              [listing.id, JSON.stringify(facts), semanticText, vectorLiteral(embedding), options.embeddings.model, options.details.model, contentHash],
            );
            await pool.query(
              `INSERT INTO enrichment_runs (listing_id, source_id, url, status, fact_count, fetched_at)
               VALUES ($1, $2, $3, 'completed', $4, now())`,
              [listing.id, source.id, url, sourceFacts.length],
            );
            listing.facts = facts;
            updated += 1;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failed.push({ listingId: listing.id, sourceId: source.id, message });
            await pool.query(
              `INSERT INTO enrichment_runs (listing_id, source_id, url, status, fact_count, error, fetched_at)
               VALUES ($1, $2, $3, 'failed', 0, $4, now())`,
              [listing.id, source.id, url, message.slice(0, 1000)],
            );
          }
        }
      }

      return { processed, updated, failed };
    },

    async close() {
      await pool.end();
    },
  };
}

async function loadListings(pool: pg.Pool, ids: string[] | undefined, limit: number): Promise<ListingRow[]> {
  const result = ids?.length
    ? await pool.query<ListingRow>("SELECT id, title, description, city, district, address, lat, lng, facts FROM listings WHERE id = ANY($1::text[]) LIMIT $2", [ids, limit])
    : await pool.query<ListingRow>("SELECT id, title, description, city, district, address, lat, lng, facts FROM listings ORDER BY indexed_at ASC LIMIT $1", [limit]);
  return result.rows;
}

async function loadSources(pool: pg.Pool, ids: string[] | undefined): Promise<SourceRow[]> {
  const result = ids?.length
    ? await pool.query<SourceRow>("SELECT id, name, url_template, scope, requires, enabled FROM enrichment_sources WHERE enabled AND id = ANY($1::text[])", [ids])
    : await pool.query<SourceRow>("SELECT id, name, url_template, scope, requires, enabled FROM enrichment_sources WHERE enabled ORDER BY name");
  return result.rows;
}

function fillTemplate(template: string, listing: ListingRow): string {
  const values: Record<string, string> = {
    id: listing.id,
    address: listing.address,
    city: listing.city,
    district: listing.district,
    lat: String(listing.lat),
    lng: String(listing.lng),
  };
  return template.replace(/\{(id|address|city|district|lat|lng)\}/g, (_, key: string) => encodeURIComponent(values[key] ?? ""));
}

async function fetchPage(url: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(url, { headers: { accept: "text/html,application/json,text/plain" }, signal: combined });
  if (!response.ok) throw new Error(`資料來源回應 ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  const raw = (await response.text()).slice(0, 300_000);
  if (contentType.includes("json")) return raw.slice(0, 60_000);
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60_000);
}

function mergeFacts(existing: unknown, sourceId: string, incoming: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const current = Array.isArray(existing) ? existing.filter((fact): fact is Record<string, unknown> => Boolean(fact) && typeof fact === "object") : [];
  const retained = current.filter((fact) => fact.enrichmentSourceId !== sourceId);
  return [...retained, ...incoming.map((fact) => ({ ...fact, enrichmentSourceId: sourceId }))];
}

function buildSemanticText(listing: ListingRow, facts: Array<Record<string, unknown>>): string {
  const factText = facts.map((fact) => `${String(fact.label ?? fact.key ?? "")}:${String(fact.displayValue ?? fact.value ?? "")}`);
  return [listing.title, listing.description, `${listing.city}${listing.district}`, listing.address, ...factText].filter(Boolean).join("；");
}

function toSource(row: SourceRow): EnrichmentSourceInput {
  return { id: row.id, name: row.name, urlTemplate: row.url_template, scope: row.scope, requires: row.requires ?? [], enabled: row.enabled };
}

function applicable(source: SourceRow, listing: ListingRow): boolean {
  const facts = Array.isArray(listing.facts) ? listing.facts.filter((fact): fact is Record<string, unknown> => Boolean(fact) && typeof fact === "object") : [];
  const available = new Set(["id", "title", "description", "city", "district", "address", "lat", "lng", ...facts.map((fact) => String(fact.key ?? ""))]);
  const scopeKey = source.scope === "address" ? "address" : source.scope === "district" ? "district" : source.scope === "city" ? "city" : "id";
  return available.has(scopeKey) && source.requires.every((key) => available.has(key));
}
