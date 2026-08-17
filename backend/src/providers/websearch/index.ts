/**
 * Tavily 網頁搜尋（https://tavily.com）。
 *
 * 補的是「本地資料庫與政府開放資料都答不出來」的那一類問題：某個建案的評價、
 * 這一區最近有沒有重大建設或負面新聞、捷運延伸線的進度。這些沒有結構化資料源，
 * 只能靠搜尋。
 *
 * 刻意只回摘要與連結，不回整頁內容：塞進 LLM context 的成本與幻覺風險都太高，
 * 而且我們要的是「有沒有這件事、出處在哪」，不是全文。
 */

export interface WebSearchConfig {
  apiKey: string;
  timeoutMs: number;
}

export class WebSearchUnavailableError extends Error {}

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  publishedDate?: string;
}

export interface WebSearchResult {
  query: string;
  /** Tavily 直接生成的摘要答案。可能為空。 */
  answer?: string;
  hits: WebSearchHit[];
}

export interface WebSearchProvider {
  search(input: {
    query: string;
    maxResults?: number;
    recentDays?: number;
    signal?: AbortSignal;
  }): Promise<WebSearchResult>;
}

const ENDPOINT = "https://api.tavily.com/search";
/** 一次最多回幾筆。再多也只是稀釋注意力，而且每筆都要進 context。 */
const MAX_RESULTS = 8;

export function createWebSearchProvider(config: WebSearchConfig): WebSearchProvider {
  return {
    async search(input) {
      const timeout = AbortSignal.timeout(config.timeoutMs);
      const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;

      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            query: input.query,
            max_results: Math.min(Math.max(input.maxResults ?? 5, 1), MAX_RESULTS),
            search_depth: "basic",
            include_answer: true,
            // 台灣的房市問題幾乎都要在地結果，不限制的話會被英文內容洗掉
            country: "taiwan",
            ...(input.recentDays ? { days: input.recentDays, topic: "news" } : {}),
          }),
          signal,
        });
      } catch (error) {
        throw new WebSearchUnavailableError(`網頁搜尋連線失敗：${error instanceof Error ? error.message : String(error)}`);
      }

      if (!response.ok) {
        const hint = response.status === 401 || response.status === 403 ? "（金鑰無效）"
          : response.status === 429 ? "（額度用完）" : "";
        throw new WebSearchUnavailableError(`網頁搜尋回應 ${response.status}${hint}`);
      }

      const json = await response.json() as {
        answer?: string;
        results?: { title?: string; url?: string; content?: string; score?: number; published_date?: string }[];
      };

      return {
        query: input.query,
        ...(json.answer ? { answer: json.answer } : {}),
        hits: (json.results ?? []).map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          // 摘要截短：完整內容動輒數千字，八筆就把 context 吃光
          snippet: (r.content ?? "").slice(0, 400),
          ...(typeof r.score === "number" ? { score: r.score } : {}),
          ...(r.published_date ? { publishedDate: r.published_date } : {}),
        })),
      };
    },
  };
}
