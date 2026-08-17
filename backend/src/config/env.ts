import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().url().default("postgres://postgres:postgres@localhost:5432/home_selector"),
  REPOSITORY_MODE: z.enum(["postgres", "memory"]).default("postgres"),
  AGENT_MODE: z.enum(["auto", "pi", "deterministic"]).default("auto"),
  PI_PROVIDER: z.enum(["google", "custom-openai"]).default("google"),
  PI_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_API_KEY: z.string().optional(),
  CUSTOM_OPENAI_BASE_URL: z.string().url().default("http://127.0.0.1:8080/v1"),
  CUSTOM_OPENAI_API_KEY: z.string().optional(),
  CUSTOM_OPENAI_MODEL_NAME: z.string().default("Custom OpenAI-compatible model"),
  CUSTOM_OPENAI_CONTEXT_WINDOW: z.coerce.number().int().positive().default(128_000),
  CUSTOM_OPENAI_MAX_TOKENS: z.coerce.number().int().positive().default(32_000),
  CUSTOM_OPENAI_REASONING: z.stringbool().default(false),
  CUSTOM_OPENAI_SUPPORTS_DEVELOPER_ROLE: z.stringbool().default(false),
  CUSTOM_OPENAI_SUPPORTS_REASONING_EFFORT: z.stringbool().default(false),
  CUSTOM_OPENAI_SUPPORTS_USAGE_IN_STREAMING: z.stringbool().default(false),
  CUSTOM_OPENAI_SUPPORTS_STRICT_MODE: z.stringbool().default(false),
  // 都市計畫圖資 (臺北市 UPIS / 新北市城鄉資訊平台 / 基隆市 UPGIS). 基隆的 ArcGIS 延遲最不穩定，
  // 同一個查詢實測過 0.2 秒也實測過 21 秒，所以單獨給一個較長的 timeout 當緩衝；
  // 分區資料以年為單位變動，快取設得長一點沒問題。
  URBAN_PLAN_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  URBAN_PLAN_SLOW_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  URBAN_PLAN_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(86_400_000),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  REQUEST_BODY_LIMIT: z.coerce.number().int().positive().default(1_048_576),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(overrides: Record<string, unknown> = {}): AppConfig {
  return envSchema.parse({ ...process.env, ...overrides });
}
