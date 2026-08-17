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
  ├─ UrbanPlanProvider ── point-level, live government GIS
  │     ├─ 臺北市 UPIS      (都發局 ArcGIS + upis_api)
  │     ├─ 新北市 城鄉資訊平台 (ArcGIS, 站方公開 token)
  │     └─ 基隆市 UPGIS      (ArcGIS 10.31, 無需認證)
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

## 都市計畫圖資 (urban plan)

Unlike every other provider, this one answers a **coordinate**, not a district, so it sits outside
`ProviderRegistry` and takes no part in candidate hydration or ranking. It reaches three official
systems directly and is the only place in the backend serving live, non-fixture government data:

| 縣市 | 服務 | 認證 | 分區資料 |
| --- | --- | --- | --- |
| 臺北市 | `historygis.udd.gov.taipei` ArcGIS + `webgis.udd.gov.taipei/upis_api` | 無 | 分區代碼、分區簡稱、使用分區、分區說明；建蔽率／容積率欄位存在但多為空 |
| 新北市 | `arcgis.planning.ntpc.gov.tw` `NTPC_Urban/LandUse_WMS` | 站方公開 token | 用地類別、分區簡稱、建蔽率、容積率（最完整） |
| 基隆市 | `upgis.klcg.gov.tw/arcgiswa` `KL_UPGIS/kl_uplan` | 無 | 使用分區、分區代碼；無建蔽率／容積率欄位 |

Design points worth keeping:

- **Two-radius search.** Roads, rivers, and some public-facility land carry no zoning polygon, so a
  bare point query misses at plenty of real addresses. The report's `match` field distinguishes a
  `parcel` hit from a `nearby` block sample, and a `nearby` answer always carries a warning saying it
  is not that parcel's statutory zoning. Nothing is ever inferred to fill a gap.
- **City resolution never widens before the alternatives are tried.** Bounding boxes only decide who
  gets asked. A coordinate in 永和 falls inside 臺北市's box and within a block of its polygons across
  the 新店溪, so widening the first city too early would answer 新北市 addresses with 臺北市 zoning.
- **Concurrency is capped per source** (`src/lib/limit-concurrency.ts`). One lookup naturally fans out
  to six to eight endpoint hits; issued all at once, these servers time each other out — measured
  15s timeouts collapsing to ~0.9s once capped at three in flight.
- **Null means the source said nothing.** 基隆 has no 建蔽率/容積率 columns and many 臺北 rows leave
  them blank; those stay `null` and the agent prompt forbids estimating them.

Exposed as `POST /urban-plan` and as the agent tool `get_urban_plan`. `pnpm urban-plan:smoke` checks
all three cities plus the route against the live services; it is not part of `pnpm test`.

## Provider roadmap

The current fixture adapter is intentionally labeled and replaceable. Likely production adapters are CWA open data for climate, OSM/Overpass for POI, TDX for transport, and a licensed or official housing-statistics source. Provider caching is represented in the database schema; the first fixture implementation does not require network caching.
