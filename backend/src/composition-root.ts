import { DeterministicAgentRuntime } from "./agent/deterministic-runtime.js";
import { PiAgentRuntime } from "./agent/pi-runtime.js";
import type { AgentRuntime } from "./agent/runtime.js";
import { buildApp } from "./app.js";
import type { AppConfig } from "./config/env.js";
import { InMemorySessionRepository, PostgresSessionRepository } from "./database/session-repository.js";
import { createFixtureProviders } from "./providers/fixture/fixture-provider.js";
import { createListingsProvider } from "./providers/listings/index.js";
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
  // 物件資料庫住在前端，這裡只借用它的排序端點（見 providers/listings）。
  const listings = createListingsProvider({ baseUrl: config.FRONTEND_URL, timeoutMs: config.LISTINGS_TIMEOUT_MS });
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
    runtime = new DeterministicAgentRuntime(preferences, recommendations);
  }
  const agent = new AgentService(sessions, runtime);
  return buildApp({ config, sessions, preferences, recommendations, agent, urbanPlan, runtimeName: runtime.name });
}
