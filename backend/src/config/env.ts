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
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  REQUEST_BODY_LIMIT: z.coerce.number().int().positive().default(1_048_576),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(overrides: Record<string, unknown> = {}): AppConfig {
  return envSchema.parse({ ...process.env, ...overrides });
}
