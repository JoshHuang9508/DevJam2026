CREATE EXTENSION IF NOT EXISTS postgis;

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

