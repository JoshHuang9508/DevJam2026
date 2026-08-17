/**
 * Twinkle Hub MCP client（https://hub.twinkleai.tw）。
 *
 * 一個端點聚合台灣政府開放資料平台 5.3 萬個資料集、法規、判決與即時災害告警。
 * pi-agent-core 沒有原生 MCP 支援，所以這裡自己實作最小可用的 JSON-RPC over
 * streamable-http：只需要 initialize 與 tools/call 兩個方法。
 *
 * 回應是 SSE（`event: message` + `data: {...}`）而不是單純的 JSON，
 * 即使只有一筆結果也一樣，所以一定要走 SSE 解析。
 */

export interface TwinkleConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

/** 外部服務掛掉或額度用完時丟這個，讓 tool 回一句話而不是把整輪對話打斷。 */
export class TwinkleUnavailableError extends Error {}

export interface TwinkleClient {
  call(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
}

export function createTwinkleClient(config: TwinkleConfig): TwinkleClient {
  let nextId = 1;

  return {
    async call(tool, args, signal) {
      const timeout = AbortSignal.timeout(config.timeoutMs);
      const merged = signal ? AbortSignal.any([signal, timeout]) : timeout;

      let response: Response;
      try {
        response = await fetch(config.baseUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
            // 少了 text/event-stream 會被伺服器拒絕 —— 它一律用 SSE 回應
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: nextId++,
            method: "tools/call",
            params: { name: tool, arguments: args },
          }),
          signal: merged,
        });
      } catch (error) {
        throw new TwinkleUnavailableError(`Twinkle Hub 連線失敗：${error instanceof Error ? error.message : String(error)}`);
      }

      if (!response.ok) {
        // 402/429 幾乎都是免費額度（每 5 小時 50 credits）用完，訊息要講得出來
        const hint = response.status === 402 || response.status === 429
          ? "（可能是免費額度用完，每 5 小時回填 50 credits）" : "";
        throw new TwinkleUnavailableError(`Twinkle Hub 回應 ${response.status}${hint}`);
      }

      const payload = parseSse(await response.text());
      if (!payload) throw new TwinkleUnavailableError("Twinkle Hub 回應無法解析");
      if (payload.error) {
        throw new TwinkleUnavailableError(`Twinkle Hub: ${payload.error.message ?? "未知錯誤"}`);
      }

      const content = payload.result?.content ?? [];
      const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
      return text || "（查無資料）";
    },
  };
}

interface RpcPayload {
  error?: { message?: string };
  result?: { content?: { type?: string; text?: string }[] };
}

/**
 * 從 SSE 串流取出最後一筆 JSON-RPC 訊息。
 * 伺服器可能先送 keep-alive 或多個 event，只有帶 result/error 的那一筆算數。
 */
function parseSse(raw: string): RpcPayload | null {
  let last: RpcPayload | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const body = line.slice(5).trim();
    if (!body || body === "[DONE]") continue;
    try {
      const parsed = JSON.parse(body) as RpcPayload;
      if (parsed.result || parsed.error) last = parsed;
    } catch {
      // keep-alive 或非 JSON 的雜訊，略過
    }
  }
  return last;
}
