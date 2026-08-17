# Taiwan Home Selector Agent Backend

Production-oriented backend contract for a Taiwan-only, multi-turn home-location recommendation agent. It uses Fastify, PostgreSQL/PostGIS, Zod, SSE, and Pi Agent Core. Scores are deterministic; the LLM never invents them.

## Current status

Implemented:

- persistent `PreferenceState` with separated hard constraints and 0–1 soft weights
- district candidates with coordinates, raw provider data, source metadata, data quality, score breakdown, confidence, highlights, and trade-offs
- deterministic hard filtering, feature normalization, missing-data redistribution, 0–100 scoring, and stable tie-breaking
- `AgentRuntime` abstraction with Pi and token-free deterministic implementations
- nine domain tools: location search, climate, housing, amenities, transport, geography, preference updates, ranking, and candidate detail
- PostgreSQL session/message/ranking persistence and in-memory test repository
- JSON API, typed SSE events, runtime OpenAPI, rate limiting, CORS, request limits, redacted logs, and partial provider failure handling
- unit/integration/SSE tests and a two-turn plus manual-adjustment demo

Current data is an explicitly marked development fixture inspired by public Taiwan datasets. It is not live housing inventory or authoritative statistics.

## Requirements

- Node.js 22.19+
- pnpm 10+
- PostgreSQL 17 + PostGIS for persistent mode
- either `GEMINI_API_KEY` or an operator-configured OpenAI-compatible endpoint for Pi execution

Docker is only needed to start local PostGIS. On a machine with Docker:

```bash
cd backend
docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev
```

Copy `.env.example` to `.env` first. The API defaults to `http://localhost:3001`, Swagger UI to `/docs`, and the raw specification to `/openapi.json`.

For a zero-infrastructure demo, set:

```dotenv
REPOSITORY_MODE=memory
AGENT_MODE=deterministic
```

Or run:

```bash
pnpm demo
```

## Agent modes and model providers

- `AGENT_MODE=auto`: use Pi when the selected provider is configured; otherwise use the deterministic CI/demo runtime.
- `AGENT_MODE=pi`: always construct `PiAgentRuntime`.
- `AGENT_MODE=deterministic`: rule-based preference interpretation for the acceptance vocabulary. This exists for reproducible CI and local demos, not as the production NLP layer.

Pi dependencies are the current `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` packages. Only domain tools are attached; coding-agent tools are never imported.

### Custom OpenAI-compatible endpoint

For a server equivalent to `OpenAI(base_url="http://127.0.0.1:8080/v1", api_key="pwd")`, configure:

```dotenv
AGENT_MODE=auto
PI_PROVIDER=custom-openai
PI_MODEL=gpt-5.6-terra
CUSTOM_OPENAI_BASE_URL=http://127.0.0.1:8080/v1
CUSTOM_OPENAI_API_KEY=pwd
CUSTOM_OPENAI_MODEL_NAME=GPT 5.6 Terra (local proxy)
```

Pi registers this model with the `openai-completions` implementation, so the effective request is `POST http://127.0.0.1:8080/v1/chat/completions`. The server must support streaming Chat Completions and OpenAI-style function/tool calling for the agent loop to operate.

Compatibility defaults favor local proxies: system role instead of developer role, no `reasoning_effort`, no streaming usage request, and no strict tool schema. Enable only capabilities your proxy implements:

```dotenv
CUSTOM_OPENAI_REASONING=true
CUSTOM_OPENAI_SUPPORTS_DEVELOPER_ROLE=true
CUSTOM_OPENAI_SUPPORTS_REASONING_EFFORT=true
CUSTOM_OPENAI_SUPPORTS_USAGE_IN_STREAMING=true
CUSTOM_OPENAI_SUPPORTS_STRICT_MODE=true
```

`CUSTOM_OPENAI_BASE_URL` is operator-controlled configuration, never a user/LLM tool argument. Keep the key server-side and do not expose it to the Next.js client.

## API contract

| Method | Path | Meaning |
|---|---|---|
| `POST` | `/sessions` | Create a search session |
| `GET` | `/sessions/:id` | Full structured session |
| `POST` | `/sessions/:id/messages` | Agent turn; JSON or SSE |
| `GET` | `/sessions/:id/preferences` | Current preference source of truth |
| `PATCH` | `/sessions/:id/preferences` | Deep-merge state and automatically rerank |
| `GET` | `/sessions/:id/candidates` | Frontend/map-ready ranking |
| `GET` | `/sessions/:id/candidates/:candidateId` | Complete candidate evidence |
| `POST` | `/sessions/:id/rank` | Refresh data and rank, or rerank existing data |

### Create and manually adjust

```bash
curl -X POST http://localhost:3001/sessions \
  -H "content-type: application/json" \
  -d '{}'

curl -X PATCH http://localhost:3001/sessions/SESSION_ID/preferences \
  -H "content-type: application/json" \
  -d '{"softPreferences":{"climate":{"weight":1}}}'
```

`PATCH` uses the same nested shape as `PreferenceState`, with every field optional. The canonical climate slider path is `softPreferences.climate.weight`. Updating it increments the preference version and automatically reranks the current candidates (or generates candidates if none exist).

### SSE

```bash
curl -N -X POST http://localhost:3001/sessions/SESSION_ID/messages \
  -H "content-type: application/json" \
  -H "accept: text/event-stream" \
  -d '{"message":"中南部，月租最高 18000，希望少雨且生活方便"}'
```

Events:

- `message.started`, `message.delta`, `message.completed`
- `tool.started`, `tool.completed`
- `preferences.updated`
- `candidates.updated`, `ranking.updated`
- `error`

Each `data:` payload is JSON and contains `type`, `turnId`, and `timestamp`. Candidate changes are structured events; the frontend never has to parse assistant prose to update the map. Without the SSE `Accept` header, the endpoint returns `{ events, session }`, which is convenient for server actions and tests.

## Frontend integration

1. Create one session and retain its UUID.
2. Render map points directly from `session.candidates[*].latitude/longitude`.
3. Subscribe to the message request's SSE response and reduce structured events into UI state.
4. Use `PATCH /preferences` for sliders. The returned preferences and candidates are authoritative.
5. Show `dataQuality`, `sources`, and `confidence`; do not present fixture values as live facts.

The reusable TypeScript/Zod contract barrel is `src/contracts.ts`. A frontend can generate a client from `/openapi.json` (for example with Orval or openapi-typescript) instead of importing backend runtime code.

## Adding a provider

Implement the relevant interface in `src/providers/types.ts`, return `ProviderResult<T>` with source metadata and quality, then replace that member in `ProviderRegistry` in `composition-root.ts`. Provider exceptions are isolated per dimension by `RecommendationService`; never return invented values for missing data.

Production adapters should add bounded timeouts, retries with jitter only for retryable errors, and cache keys that include provider/version/location. Generic user-controlled URLs are prohibited.

## Adding an agent tool

Add an `AgentTool` in `src/agent/tools/domain-tools.ts` using a TypeBox argument schema. Keep its authority narrow, validate again at the domain boundary, return structured JSON as tool content/details, and emit a typed application event for frontend-visible mutations. Do not expose generic HTTP, shell, or filesystem access.

## Database

`src/database/schema.sql` enables PostGIS and creates:

- `search_sessions`
- `conversation_messages`
- `ranking_snapshots`
- `provider_cache` (reserved for live adapters)

Run `pnpm db:migrate`. Queries are parameterized. The first recommendation granularity is administrative district, so PostGIS geometry is not yet required in business logic; the extension is ready for future radius/commute queries.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm demo
```

Tests do not call a paid model. They cover preference merge/validation, hard filtering, deterministic scoring, missing data, state consistency across two turns, manual reranking, SSE events, and OpenAPI publication.

## Observability and errors

Fastify logs request id, latency/status, and server errors while redacting authorization and message bodies. Tool events include call id, name, error state, and duration. Provider source metadata includes `fetchedAt`. Pi messages expose provider usage internally; a production telemetry sink can persist token usage without logging full user content.

Provider failures become `dataQuality: "missing"`; ranking redistributes unavailable weight. Invalid tool/API arguments fail validation. Model failure emits a recoverable SSE `error`. Database errors return a generic 500 and retain detailed server logs.

## Limitations

- fixture data only; values are not suitable for real housing decisions
- no individual listings, purchases, route planning, accounts, billing, vector DB, RAG, or multi-agent workflow
- `maxCommuteMinutes` is modeled but cannot be enforced until a route-time provider exists
- fixture normalization is relative to the current candidate set, so scores compare candidates within a run rather than representing an absolute national index
- production concurrent writes to one session should add optimistic locking

See [`docs/architecture.md`](docs/architecture.md) for the component and trust-boundary rationale.
