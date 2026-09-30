CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  url TEXT NOT NULL,
  scraped_at TIMESTAMPTZ NOT NULL,
  address TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  geocode_source TEXT NOT NULL DEFAULT 'provided',
  geocode_precision TEXT NOT NULL DEFAULT 'unknown',
  geocode_matched_address TEXT,
  facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  semantic_text TEXT NOT NULL,
  embedding vector(1536),
  embedding_model TEXT,
  extraction_model TEXT,
  content_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  ingest_run_id UUID,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_document TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(address, '') || ' ' || coalesce(semantic_text, ''))
  ) STORED,
  UNIQUE(source, source_id)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'listings' AND column_name = 'mode') THEN
    TRUNCATE TABLE listings CASCADE;
  END IF;
END $$;

DROP INDEX IF EXISTS listings_mode_city_district_idx;
DROP INDEX IF EXISTS listings_filter_idx;
ALTER TABLE listings DROP COLUMN IF EXISTS search_document;
ALTER TABLE listings DROP COLUMN IF EXISTS mode;
ALTER TABLE listings DROP COLUMN IF EXISTS title;
ALTER TABLE listings DROP COLUMN IF EXISTS description;
ALTER TABLE listings DROP COLUMN IF EXISTS city;
ALTER TABLE listings DROP COLUMN IF EXISTS district;
ALTER TABLE listings DROP COLUMN IF EXISTS price;
ALTER TABLE listings DROP COLUMN IF EXISTS unit_price;
ALTER TABLE listings DROP COLUMN IF EXISTS area;
ALTER TABLE listings DROP COLUMN IF EXISTS layout;
ALTER TABLE listings DROP COLUMN IF EXISTS rooms;
ALTER TABLE listings DROP COLUMN IF EXISTS floor;
ALTER TABLE listings DROP COLUMN IF EXISTS total_floor;
ALTER TABLE listings DROP COLUMN IF EXISTS age;
ALTER TABLE listings DROP COLUMN IF EXISTS building_type;
ALTER TABLE listings DROP COLUMN IF EXISTS has_elevator;
ALTER TABLE listings DROP COLUMN IF EXISTS has_parking;
ALTER TABLE listings DROP COLUMN IF EXISTS details;
ALTER TABLE listings DROP COLUMN IF EXISTS features;
ALTER TABLE listings DROP COLUMN IF EXISTS detail_extraction_model;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS extraction_model TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS source_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE listings ADD COLUMN IF NOT EXISTS ingest_run_id UUID;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS geocode_source TEXT NOT NULL DEFAULT 'provided';
ALTER TABLE listings ADD COLUMN IF NOT EXISTS geocode_precision TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE listings ADD COLUMN IF NOT EXISTS geocode_matched_address TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS facts JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS search_document TSVECTOR GENERATED ALWAYS AS (
  to_tsvector('simple', coalesce(address, '') || ' ' || coalesce(semantic_text, ''))
) STORED;
CREATE INDEX IF NOT EXISTS listings_search_document_idx ON listings USING gin(search_document);
CREATE INDEX IF NOT EXISTS listings_embedding_idx ON listings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS listings_facts_idx ON listings USING gin(facts jsonb_path_ops);

CREATE TABLE IF NOT EXISTS raw_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_url TEXT NOT NULL,
  document_mode TEXT NOT NULL CHECK (document_mode IN ('single', 'links', 'json')),
  link_pattern TEXT,
  max_documents INTEGER NOT NULL DEFAULT 20,
  default_mode TEXT CHECK (default_mode IN ('sale', 'rent')),
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  refresh_minutes INTEGER NOT NULL DEFAULT 1440,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'completed_with_errors', 'failed')),
  summary JSONB,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS raw_documents (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES raw_sources(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  normalization_model TEXT NOT NULL,
  normalized JSONB,
  status TEXT NOT NULL CHECK (status IN ('fetched', 'normalized', 'processed', 'failed')),
  error TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  normalized_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  UNIQUE(source_id, url, content_hash, normalization_model)
);

ALTER TABLE raw_documents ADD COLUMN IF NOT EXISTS normalization_model TEXT NOT NULL DEFAULT '';
ALTER TABLE raw_documents DROP CONSTRAINT IF EXISTS raw_documents_source_id_url_content_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS raw_documents_source_url_hash_model_idx ON raw_documents(source_id, url, content_hash, normalization_model);
CREATE INDEX IF NOT EXISTS raw_documents_source_status_idx ON raw_documents(source_id, status, fetched_at DESC);

CREATE TABLE IF NOT EXISTS enrichment_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url_template TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('listing', 'address', 'district', 'city')),
  requires JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE enrichment_sources ADD COLUMN IF NOT EXISTS requires JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS enrichment_runs (
  id BIGSERIAL PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES enrichment_sources(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  fact_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS enrichment_runs_listing_source_idx ON enrichment_runs(listing_id, source_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS geocode_cache (
  address TEXT PRIMARY KEY,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  precision TEXT NOT NULL DEFAULT 'approximate',
  matched_address TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((lat IS NULL) = (lng IS NULL))
);

ALTER TABLE geocode_cache ADD COLUMN IF NOT EXISTS precision TEXT NOT NULL DEFAULT 'approximate';

CREATE TABLE IF NOT EXISTS search_sessions (
  id UUID PRIMARY KEY,
  user_id TEXT,
  preferences JSONB NOT NULL,
  candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES search_sessions(id) ON DELETE CASCADE,
  turn_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_messages_session_created_idx
  ON conversation_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS ranking_snapshots (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES search_sessions(id) ON DELETE CASCADE,
  preference_version INTEGER NOT NULL,
  candidates JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ranking_snapshots_session_created_idx
  ON ranking_snapshots(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_cache (
  cache_key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  source_metadata JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_cache_expires_idx ON provider_cache(expires_at);
