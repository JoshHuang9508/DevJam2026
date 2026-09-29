import { z } from "zod";

const factSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  group: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())]),
  displayValue: z.string().optional(),
  unit: z.string().optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().min(1),
});

const normalizedListingSchema = z.object({
  sourceId: z.string().optional(),
  url: z.string().optional(),
  mode: z.enum(["sale", "rent"]).optional(),
  title: z.string().min(1),
  description: z.string().default(""),
  city: z.string().optional(),
  district: z.string().optional(),
  address: z.string().optional(),
  price: z.number().nonnegative().optional(),
  unitPrice: z.number().nonnegative().optional(),
  area: z.number().nonnegative().optional(),
  layout: z.string().optional(),
  rooms: z.number().int().nonnegative().optional(),
  floor: z.number().int().optional(),
  totalFloor: z.number().int().nonnegative().optional(),
  age: z.number().nonnegative().optional(),
  buildingType: z.string().optional(),
  hasElevator: z.boolean().optional(),
  hasParking: z.boolean().optional(),
  facts: z.array(factSchema).max(100).default([]),
});

const normalizationSchema = z.object({ listings: z.array(normalizedListingSchema).max(50).default([]) });

export type NormalizedListing = z.infer<typeof normalizedListingSchema>;

export interface RawNormalizer {
  readonly model: string;
  normalize(input: { sourceName: string; sourceUrl: string; content: string }, signal?: AbortSignal): Promise<NormalizedListing[]>;
}

export function createRawNormalizer(options: { mode: "off" | "openai" | "google"; model: string; baseUrl?: string; apiKey?: string }): RawNormalizer {
  if (options.mode === "off") return { model: "off", async normalize() { throw new Error("AI normalizer 尚未設定"); } };
  if (!options.apiKey) throw new Error(`DETAIL_EXTRACTION_MODE=${options.mode} 時必須設定 API key`);
  return options.mode === "google"
    ? new GoogleRawNormalizer(options.model, options.apiKey)
    : new OpenAiRawNormalizer(options.model, options.apiKey, options.baseUrl ?? "https://api.openai.com/v1");
}

const instruction = `你是房屋資料正規化器。輸入可能是 HTML 轉出的文字、JSON、CSV 或單一物件描述，也可能同時包含多個物件。找出每個物件並輸出 JSON {"listings":[]}。固定核心欄位只在內容能確認時填入：sourceId、url、mode、title、description、city、district、address、price、unitPrice、area、layout、rooms、floor、totalFloor、age、buildingType、hasElevator、hasParking。price：買賣使用萬元、租賃使用元/月；area 使用坪；age 使用年。其餘所有有助於找房且有證據的資訊放入 facts，不限制 key。每筆 fact 包含穩定英文 lowerCamelCase key、繁體中文 label 與 group、正確型別 value、可直接顯示的 displayValue、可選 unit、0 到 1 confidence、支持此事實的原文 evidence。不得猜測，無法確認的核心欄位省略，無法確認的 fact 不輸出。只輸出 JSON。`;

class OpenAiRawNormalizer implements RawNormalizer {
  constructor(readonly model: string, private readonly apiKey: string, private readonly baseUrl: string) {}

  async normalize(input: { sourceName: string; sourceUrl: string; content: string }, signal?: AbortSignal): Promise<NormalizedListing[]> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: instruction }, { role: "user", content: `來源：${input.sourceName}\n網址：${input.sourceUrl}\n內容：\n${input.content}` }] }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`Raw normalizer API 回應 ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return parse(body.choices?.[0]?.message?.content ?? "{}");
  }
}

class GoogleRawNormalizer implements RawNormalizer {
  constructor(readonly model: string, private readonly apiKey: string) {}

  async normalize(input: { sourceName: string; sourceUrl: string; content: string }, signal?: AbortSignal): Promise<NormalizedListing[]> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: instruction }] }, contents: [{ role: "user", parts: [{ text: `來源：${input.sourceName}\n網址：${input.sourceUrl}\n內容：\n${input.content}` }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`Raw normalizer Google API 回應 ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return parse(body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "{}");
  }
}

function parse(text: string): NormalizedListing[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    return normalizationSchema.parse(JSON.parse(match[0])).listings;
  } catch {
    return [];
  }
}
