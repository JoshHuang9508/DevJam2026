import { z } from "zod";

const factValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())]);
const extractedFactSchema = z.object({
  key: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  label: z.string().min(1),
  group: z.string().min(1),
  value: factValueSchema,
  displayValue: z.string().optional(),
  unit: z.string().optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().min(1),
});
const extractionSchema = z.object({ facts: z.array(extractedFactSchema).max(80).default([]) });

export type ExtractedFacts = z.infer<typeof extractionSchema>;

export interface FactExtractor {
  readonly model: string;
  extract(description: string, signal?: AbortSignal): Promise<ExtractedFacts>;
}

export function createFactExtractor(options: {
  mode: "off" | "openai" | "google";
  model: string;
  baseUrl?: string;
  apiKey?: string;
}): FactExtractor {
  if (options.mode === "off") return { model: "off", async extract() { return { facts: [] }; } };
  if (!options.apiKey) throw new Error(`FACT_EXTRACTION_MODE=${options.mode} 時必須設定 API key`);
  return options.mode === "google" ? new GoogleFactExtractor(options.model, options.apiKey) : new OpenAiFactExtractor(options.model, options.apiKey, options.baseUrl ?? "https://api.openai.com/v1");
}

const instruction = `你是房屋與環境資料萃取器。只根據提供內容輸出 JSON，不得補常識或猜測。找出所有對找房有意義且有原文證據的事實，不限定欄位。輸出 {"facts":[]}。每筆 fact 包含：key 使用穩定的英文 lowerCamelCase；label 使用繁體中文；group 使用簡短繁體中文分類；value 保留正確的字串、數字、布林或同型別陣列；displayValue 是可直接顯示的繁體中文文字；unit 在有單位時提供；confidence 為 0 到 1；evidence 必須是支持此事實的原文短句。不要輸出無法確認的 fact。只輸出 JSON。`;

class OpenAiFactExtractor implements FactExtractor {
  constructor(readonly model: string, private readonly apiKey: string, private readonly baseUrl: string) {}

  async extract(description: string, signal?: AbortSignal): Promise<ExtractedFacts> {
    if (description.trim().length < 12) return { facts: [] };
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: instruction }, { role: "user", content: description }] }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`細節萃取 API 回應 ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return parseFacts(body.choices?.[0]?.message?.content ?? "{}");
  }
}

class GoogleFactExtractor implements FactExtractor {
  constructor(readonly model: string, private readonly apiKey: string) {}

  async extract(description: string, signal?: AbortSignal): Promise<ExtractedFacts> {
    if (description.trim().length < 12) return { facts: [] };
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: instruction }] }, contents: [{ role: "user", parts: [{ text: description }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`Google 細節萃取 API 回應 ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return parseFacts(body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "{}");
  }
}

function parseFacts(text: string): ExtractedFacts {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { facts: [] };
  try { return extractionSchema.parse(JSON.parse(match[0])); }
  catch { return { facts: [] }; }
}
