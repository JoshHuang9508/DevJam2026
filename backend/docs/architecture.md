# Architecture

## Boundary

The backend recommends Taiwan administrative districts, not individual listings. Natural-language interpretation, factual data, persistent preferences, and scoring are deliberately separate.

```text
Next.js frontend
  │ HTTP JSON / SSE
  ▼
Fastify API ───────────── OpenAPI
  │
  ├─ AgentService ── AgentRuntime interface
  │                    ├─ PiAgentRuntime (Google or custom OpenAI-compatible via pi-ai)
  │                    └─ DeterministicAgentRuntime (CI/demo fallback)
  │
  ├─ PreferenceService ── one structured PreferenceState
  │
  ├─ RecommendationService
  │     ├─ provider hydration with partial-failure isolation
  │     └─ deterministic ranking engine
  │
  ├─ replaceable provider interfaces
  │     └─ FixtureProvider v1
  │
  └─ SessionRepository
        ├─ PostgreSQL/PostGIS
        └─ in-memory (tests/demo)
```

## Trust boundaries

- The LLM may interpret requests, select domain tools, and explain tool results.
- `PreferenceState` is the source of truth for user intent. Conversation text is not a substitute.
- Providers are the only source of factual inputs. Each result carries source metadata, fetch time, quality, and a fixture flag.
- The ranking engine alone filters hard constraints and calculates scores.
- No shell, filesystem, arbitrary URL, or generic HTTP tool is exposed to Pi.

## Ranking

1. Candidate generator enforces Taiwan region/city/district scope.
2. Median rent hard constraints remove ineligible candidates.
3. Domain features are normalized within the eligible comparison set.
4. Sub-features use deterministic preferences (for example distance decay for rail access and target-range penalty for temperature).
5. Top-level available weights are normalized to sum to one. A missing dimension gets zero effective weight and its weight is redistributed.
6. Final score is the sum of dimension contributions on a 0–100 scale.
7. Ties use confidence, lower rent, then stable candidate id.

The response includes raw score, requested weight, effective weight, contribution, availability, confidence, highlights, and trade-offs.

## Persistence and concurrency

PostgreSQL stores sessions, conversation messages, candidate snapshots, and ranking history. State-changing application tools execute sequentially inside a Pi turn. API validation and parameterized SQL protect boundaries. For a multi-instance production deployment, add optimistic concurrency (`updated_at`/version compare-and-swap) before allowing simultaneous writes to the same session.

## Provider roadmap

The current fixture adapter is intentionally labeled and replaceable. Likely production adapters are CWA open data for climate, OSM/Overpass for POI, TDX for transport, and a licensed or official housing-statistics source. Provider caching is represented in the database schema; the first fixture implementation does not require network caching.
