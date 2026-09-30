import { DeterministicAgentRuntime } from "./agent/deterministic-runtime.js";
import { PiAgentRuntime } from "./agent/pi-runtime.js";
import type { AgentRuntime } from "./agent/runtime.js";
import { buildApp } from "./app.js";
import type { AppConfig } from "./config/env.js";
import { InMemorySessionRepository, PostgresSessionRepository } from "./database/session-repository.js";
import { createEmbeddingProvider } from "./embeddings/provider.js";
import { createListingEvaluator } from "./assessment/evaluator.js";
import { createFactExtractor } from "./facts/extractor.js";
import { createListingIngestion } from "./database/listing-ingestion.js";
import { createGeocodingService } from "./geocoding/service.js";
import { createEnrichmentService } from "./enrichment/service.js";
import { createRawNormalizer } from "./pipeline/normalizer.js";
import { createPipelineService } from "./pipeline/service.js";
import { createFixtureProviders } from "./providers/fixture/fixture-provider.js";
import { createListingsProvider } from "./providers/listings/index.js";
import { createTwinkleClient } from "./providers/twinkle/index.js";
import { createWebSearchProvider } from "./providers/websearch/index.js";
import { createUrbanPlanProvider } from "./providers/urban-plan/index.js";
import { AgentService } from "./services/agent.service.js";
import { PreferenceService } from "./services/preference.service.js";
import { RecommendationService } from "./services/recommendation.service.js";
import { SessionService } from "./services/session.service.js";

export async function createApplication(config: AppConfig) {
  const repository = config.REPOSITORY_MODE === "postgres" ? new PostgresSessionRepository(config.DATABASE_URL) : new InMemorySessionRepository();
  const sessions = new SessionService(repository);
  const providers = createFixtureProviders();
  // Point-level, not district-level: kept outside ProviderRegistry because it answers a coordinate,
  // not a candidate, and takes no part in candidate hydration or ranking.
  const urbanPlan = createUrbanPlanProvider({
    timeoutMs: config.URBAN_PLAN_TIMEOUT_MS,
    slowTimeoutMs: config.URBAN_PLAN_SLOW_TIMEOUT_MS,
    cacheTtlMs: config.URBAN_PLAN_CACHE_TTL_MS,
  });
  const embeddings = createEmbeddingProvider({
    mode: config.EMBEDDING_MODE,
    baseUrl: config.EMBEDDING_BASE_URL,
    ...(config.EMBEDDING_API_KEY ? { apiKey: config.EMBEDDING_API_KEY } : {}),
    model: config.EMBEDDING_MODEL,
    dimensions: config.EMBEDDING_DIMENSIONS,
  });
  const requestedFactMode = config.FACT_EXTRACTION_MODE;
  const factMode = requestedFactMode === "auto" ? config.FACT_EXTRACTION_API_KEY ? "openai" : config.GEMINI_API_KEY ? "google" : config.CUSTOM_OPENAI_API_KEY ? "openai" : "off" : requestedFactMode;
  const factApiKey = config.FACT_EXTRACTION_API_KEY ?? (factMode === "google" ? config.GEMINI_API_KEY : config.CUSTOM_OPENAI_API_KEY);
  const factModel = config.FACT_EXTRACTION_MODEL ?? (factMode === "google" && config.PI_PROVIDER !== "google" ? "gemini-2.5-flash" : config.PI_MODEL);
  const requestedAssessmentMode = config.ASSESSMENT_MODE;
  const assessmentMode = requestedAssessmentMode === "auto" ? config.ASSESSMENT_API_KEY ? "openai" : config.GEMINI_API_KEY ? "google" : config.CUSTOM_OPENAI_API_KEY ? "openai" : "off" : requestedAssessmentMode;
  const assessmentApiKey = config.ASSESSMENT_API_KEY ?? (assessmentMode === "google" ? config.GEMINI_API_KEY : config.CUSTOM_OPENAI_API_KEY);
  const assessmentUsesCustomOpenAi = assessmentMode === "openai" && !config.ASSESSMENT_API_KEY && Boolean(config.CUSTOM_OPENAI_API_KEY);
  const assessmentModel = config.ASSESSMENT_MODEL ?? (assessmentMode === "google" && config.PI_PROVIDER !== "google" ? "gemini-2.5-flash" : assessmentUsesCustomOpenAi || assessmentMode === "google" ? config.PI_MODEL : "gpt-4o-mini");
  const assessmentBaseUrl = config.ASSESSMENT_BASE_URL ?? (assessmentUsesCustomOpenAi ? config.CUSTOM_OPENAI_BASE_URL : "https://api.openai.com/v1");
  const evaluator = createListingEvaluator({ mode: assessmentMode, model: assessmentModel, baseUrl: assessmentBaseUrl, ...(assessmentApiKey ? { apiKey: assessmentApiKey } : {}) });
  const listings = createListingsProvider({ databaseUrl: config.DATABASE_URL, embeddings, evaluator });
  const factExtractor = createFactExtractor({ mode: factMode, model: factModel, baseUrl: config.FACT_EXTRACTION_BASE_URL ?? config.CUSTOM_OPENAI_BASE_URL, ...(factApiKey ? { apiKey: factApiKey } : {}) });
  const ingestion = createListingIngestion({ databaseUrl: config.DATABASE_URL, embeddings });
  const enrichment = createEnrichmentService({ databaseUrl: config.DATABASE_URL, embeddings, facts: factExtractor });
  const geocoding = createGeocodingService({
    databaseUrl: config.DATABASE_URL,
    baseUrl: config.NOMINATIM_URL,
    userAgent: config.NOMINATIM_USER_AGENT,
    ...(config.NOMINATIM_EMAIL ? { email: config.NOMINATIM_EMAIL } : {}),
    budget: config.GEOCODE_BUDGET,
    minIntervalMs: config.GEOCODE_MIN_INTERVAL_MS,
  });
  const normalizer = createRawNormalizer({ mode: factMode, model: factModel, baseUrl: config.FACT_EXTRACTION_BASE_URL ?? config.CUSTOM_OPENAI_BASE_URL, ...(factApiKey ? { apiKey: factApiKey } : {}) });
  const pipeline = createPipelineService({ databaseUrl: config.DATABASE_URL, normalizer, geocoding, ingestion, enrichment, fetchTimeoutMs: config.PIPELINE_FETCH_TIMEOUT_MS });
  pipeline.start(config.PIPELINE_POLL_INTERVAL_MS);
  // 沒有金鑰就是 null，domain-tools 會整組跳過不註冊
  const twinkle = config.TWINKLE_API_KEY
    ? createTwinkleClient({ baseUrl: config.TWINKLE_MCP_URL, apiKey: config.TWINKLE_API_KEY, timeoutMs: config.TWINKLE_TIMEOUT_MS })
    : null;
  const webSearch = config.TAVILY_API_KEY
    ? createWebSearchProvider({ apiKey: config.TAVILY_API_KEY, timeoutMs: config.WEB_SEARCH_TIMEOUT_MS })
    : null;
  const preferences = new PreferenceService(sessions);
  const recommendations = new RecommendationService(sessions, providers);
  let runtime: AgentRuntime;
  const providerConfigured = config.PI_PROVIDER === "google" ? Boolean(config.GEMINI_API_KEY) : Boolean(config.CUSTOM_OPENAI_BASE_URL);
  const usePi = config.AGENT_MODE === "pi" || (config.AGENT_MODE === "auto" && providerConfigured);
  if (usePi) {
    const selectedApiKey = config.PI_PROVIDER === "google" ? config.GEMINI_API_KEY : config.CUSTOM_OPENAI_API_KEY;
    const options = {
      provider: config.PI_PROVIDER,
      modelId: config.PI_MODEL,
      sessions,
      preferences,
      recommendations,
      providers,
      urbanPlan,
      listings,
      twinkle,
      webSearch,
      ...(selectedApiKey ? { apiKey: selectedApiKey } : {}),
      ...(config.PI_PROVIDER === "custom-openai" ? {
        custom: {
          baseUrl: config.CUSTOM_OPENAI_BASE_URL,
          name: config.CUSTOM_OPENAI_MODEL_NAME,
          contextWindow: config.CUSTOM_OPENAI_CONTEXT_WINDOW,
          maxTokens: config.CUSTOM_OPENAI_MAX_TOKENS,
          reasoning: config.CUSTOM_OPENAI_REASONING,
          supportsDeveloperRole: config.CUSTOM_OPENAI_SUPPORTS_DEVELOPER_ROLE,
          supportsReasoningEffort: config.CUSTOM_OPENAI_SUPPORTS_REASONING_EFFORT,
          supportsUsageInStreaming: config.CUSTOM_OPENAI_SUPPORTS_USAGE_IN_STREAMING,
          supportsStrictMode: config.CUSTOM_OPENAI_SUPPORTS_STRICT_MODE,
        },
      } : {}),
    };
    runtime = new PiAgentRuntime(options);
  } else {
    runtime = new DeterministicAgentRuntime(preferences);
  }
  const agent = new AgentService(sessions, runtime);
  return buildApp({ config, sessions, preferences, recommendations, agent, urbanPlan, listings, ingestion, geocoding, enrichment, pipeline, runtimeName: runtime.name });
}
