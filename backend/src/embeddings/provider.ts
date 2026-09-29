import { createHash } from "node:crypto";

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(text: string, signal?: AbortSignal): Promise<number[]>;
}

export function createEmbeddingProvider(options: {
  mode: "hash" | "openai";
  baseUrl: string;
  apiKey?: string;
  model: string;
  dimensions: number;
}): EmbeddingProvider {
  if (options.dimensions !== 1536) throw new Error("EMBEDDING_DIMENSIONS 必須是 1536，需與 listings.embedding schema 一致");
  if (options.mode === "openai") {
    if (!options.apiKey) throw new Error("EMBEDDING_MODE=openai 時必須設定 EMBEDDING_API_KEY");
    return new OpenAiEmbeddingProvider({ baseUrl: options.baseUrl, apiKey: options.apiKey, model: options.model, dimensions: options.dimensions });
  }
  return new HashEmbeddingProvider(options.dimensions);
}

class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(options: { baseUrl: string; apiKey: string; model: string; dimensions: number }) {
    this.endpoint = `${options.baseUrl.replace(/\/$/, "")}/embeddings`;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.dimensions = options.dimensions;
  }

  async embed(text: string, signal?: AbortSignal): Promise<number[]> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: text, dimensions: this.dimensions }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`Embedding API 回應 ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const body = await response.json() as { data?: Array<{ embedding?: number[] }> };
    const vector = body.data?.[0]?.embedding;
    if (!vector || vector.length !== this.dimensions) throw new Error(`Embedding 維度錯誤，預期 ${this.dimensions}，收到 ${vector?.length ?? 0}`);
    return normalize(vector);
  }
}

class HashEmbeddingProvider implements EmbeddingProvider {
  readonly model = "hash-ngram-v1";

  constructor(readonly dimensions: number) {}

  async embed(text: string): Promise<number[]> {
    const normalized = text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
    const terms = normalized.split(" ").filter(Boolean);
    const chars = [...normalized.replaceAll(" ", "")];
    for (let size = 1; size <= 3; size += 1) {
      for (let index = 0; index <= chars.length - size; index += 1) terms.push(chars.slice(index, index + size).join(""));
    }
    const vector = Array<number>(this.dimensions).fill(0);
    for (const term of terms) {
      const digest = createHash("sha256").update(term).digest();
      const slot = digest.readUInt32BE(0) % this.dimensions;
      vector[slot] = (vector[slot] ?? 0) + (digest[4]! % 2 === 0 ? 1 : -1);
    }
    return normalize(vector);
  }
}

export function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

function normalize(vector: number[]): number[] {
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return length === 0 ? vector : vector.map((value) => value / length);
}
