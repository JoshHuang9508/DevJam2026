import { createModels, createProvider, envApiKeyAuth, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";

export interface PiModelProviderConfig {
  provider: "google" | "custom-openai";
  modelId: string;
  apiKey?: string;
  custom?: {
    baseUrl: string;
    name: string;
    contextWindow: number;
    maxTokens: number;
    reasoning: boolean;
    supportsDeveloperRole: boolean;
    supportsReasoningEffort: boolean;
    supportsUsageInStreaming: boolean;
    supportsStrictMode: boolean;
  };
}

export function createConfiguredModels(config: PiModelProviderConfig) {
  const models = createModels();
  if (config.provider === "google") {
    models.setProvider(googleProvider());
  } else {
    if (!config.custom) throw new Error("Custom OpenAI provider configuration is missing");
    const customModel: Model<"openai-completions"> = {
      id: config.modelId,
      name: config.custom.name,
      api: "openai-completions",
      provider: "custom-openai",
      baseUrl: config.custom.baseUrl.replace(/\/$/, ""),
      reasoning: config.custom.reasoning,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: config.custom.contextWindow,
      maxTokens: config.custom.maxTokens,
      compat: {
        supportsDeveloperRole: config.custom.supportsDeveloperRole,
        supportsReasoningEffort: config.custom.supportsReasoningEffort,
        supportsUsageInStreaming: config.custom.supportsUsageInStreaming,
        supportsStrictMode: config.custom.supportsStrictMode,
      },
    };
    models.setProvider(createProvider({
      id: "custom-openai",
      name: "Custom OpenAI-compatible provider",
      baseUrl: customModel.baseUrl,
      auth: { apiKey: envApiKeyAuth("Custom OpenAI API key", ["CUSTOM_OPENAI_API_KEY"]) },
      models: [customModel],
      api: openAICompletionsApi(),
    }));
  }
  const providerId = config.provider === "google" ? "google" : "custom-openai";
  const model = models.getModel(providerId, config.modelId);
  if (!model) throw new Error(`Pi model not found: ${providerId}/${config.modelId}`);
  return { models, model };
}

