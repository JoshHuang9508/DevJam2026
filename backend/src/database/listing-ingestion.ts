import { createHash } from "node:crypto";
import pg from "pg";
import { z } from "zod";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { vectorLiteral } from "../embeddings/provider.js";

const { Pool } = pg;

export const listingFactSchema = z.object({
  key: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  label: z.string().min(1),
  group: z.string().min(1),
  value: z.unknown(),
  displayValue: z.string(),
  unit: z.string().optional(),
  sourceName: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  observedAt: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.string().optional(),
  enrichmentSourceId: z.string().optional(),
});

export const ingestListingSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  sourceId: z.string().min(1),
  url: z.string(),
  scrapedAt: z.number().nonnegative(),
  address: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  geocodeSource: z.enum(["nominatim", "district_derived", "city_derived", "district_reference", "city_reference", "provided"]).default("provided"),
  geocodePrecision: z.enum(["exact", "approximate", "unknown"]).default("unknown"),
  geocodeMatchedAddress: z.string().nullable().default(null),
  extractionModel: z.string().optional(),
  facts: z.array(listingFactSchema).default([]),
});

export type IngestListing = z.infer<typeof ingestListingSchema>;
export type ListingFact = z.infer<typeof listingFactSchema>;

export interface ListingIngestion {
  ingest(runId: string, items: IngestListing[], signal?: AbortSignal): Promise<{ received: number; updated: number; skipped: number }>;
  complete(runId: string, source: string): Promise<{ deleted: number }>;
  close(): Promise<void>;
}

export function createListingIngestion(options: { databaseUrl: string; embeddings: EmbeddingProvider }): ListingIngestion {
  const pool = new Pool({ connectionString: options.databaseUrl });
  return {
    async ingest(runId, rawItems, signal) {
      const items = rawItems.map((item) => ingestListingSchema.parse(item));
      let updated = 0;
      let skipped = 0;
      for (const item of items) {
        const sourceHash = hash({ ...item, embeddingModel: options.embeddings.model });
        const existing = await pool.query<{ source_hash: string }>("SELECT source_hash FROM listings WHERE id = $1", [item.id]);
        if (existing.rows[0]?.source_hash === sourceHash) {
          await pool.query("UPDATE listings SET ingest_run_id = $2 WHERE id = $1", [item.id, runId]);
          skipped += 1;
          continue;
        }
        const facts = dedupeFacts(item.facts);
        const semanticText = buildSemanticText(item.address, facts);
        const embedding = await options.embeddings.embed(semanticText, signal);
        const contentHash = hash({ sourceHash, semanticText });
        await pool.query({
          text: `INSERT INTO listings (id, source, source_id, url, scraped_at, address, lat, lng, geocode_source, geocode_precision, geocode_matched_address, facts, semantic_text, embedding, embedding_model, extraction_model, content_hash, source_hash, ingest_run_id, indexed_at)
            VALUES ($1,$2,$3,$4,to_timestamp($5 / 1000.0),$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14::vector,$15,$16,$17,$18,$19,now())
            ON CONFLICT (id) DO UPDATE SET source=excluded.source, source_id=excluded.source_id, url=excluded.url, scraped_at=excluded.scraped_at, address=excluded.address, lat=excluded.lat, lng=excluded.lng, geocode_source=excluded.geocode_source, geocode_precision=excluded.geocode_precision, geocode_matched_address=excluded.geocode_matched_address, facts=excluded.facts, semantic_text=excluded.semantic_text, embedding=excluded.embedding, embedding_model=excluded.embedding_model, extraction_model=excluded.extraction_model, content_hash=excluded.content_hash, source_hash=excluded.source_hash, ingest_run_id=excluded.ingest_run_id, indexed_at=now()`,
          values: [item.id, item.source, item.sourceId, item.url, item.scrapedAt, item.address, item.lat, item.lng, item.geocodeSource, item.geocodePrecision, item.geocodeMatchedAddress, JSON.stringify(facts), semanticText, vectorLiteral(embedding), options.embeddings.model, item.extractionModel ?? null, contentHash, sourceHash, runId],
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

function dedupeFacts(facts: ListingFact[]): ListingFact[] {
  const merged = new Map<string, ListingFact>();
  for (const fact of facts) merged.set(fact.key, fact);
  return [...merged.values()];
}

function buildSemanticText(address: string, facts: ListingFact[]): string {
  return [address, ...facts.map((fact) => `${fact.label}:${fact.displayValue}`)].filter(Boolean).join("；");
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
