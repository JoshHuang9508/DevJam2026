import { describe, expect, it } from "vitest";
import { createConfiguredModels } from "../src/agent/model-provider.js";
import { loadConfig } from "../src/config/env.js";

describe("Pi model provider configuration", () => {
  it("registers a custom OpenAI-compatible Chat Completions model", () => {
    const { models, model } = createConfiguredModels({
      provider: "custom-openai",
      modelId: "gpt-5.6-terra",
      apiKey: "pwd",
      custom: {
        baseUrl: "http://127.0.0.1:8080/v1/",
        name: "GPT 5.6 Terra",
        contextWindow: 128_000,
        maxTokens: 32_000,
        reasoning: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsUsageInStreaming: false,
        supportsStrictMode: false,
      },
    });
    expect(models.getProvider("custom-openai")).toBeDefined();
    expect(model.provider).toBe("custom-openai");
    expect(model.api).toBe("openai-completions");
    expect(model.baseUrl).toBe("http://127.0.0.1:8080/v1");
    expect(model.id).toBe("gpt-5.6-terra");
    expect((model.compat as { supportsStrictMode?: boolean } | undefined)?.supportsStrictMode).toBe(false);
  });

  it("parses custom-provider environment settings", () => {
    const config = loadConfig({
      PI_PROVIDER: "custom-openai",
      PI_MODEL: "gpt-5.6-terra",
      CUSTOM_OPENAI_BASE_URL: "http://127.0.0.1:8080/v1",
      CUSTOM_OPENAI_REASONING: "true",
    });
    expect(config.PI_PROVIDER).toBe("custom-openai");
    expect(config.PI_MODEL).toBe("gpt-5.6-terra");
    expect(config.CUSTOM_OPENAI_REASONING).toBe(true);
  });
});
