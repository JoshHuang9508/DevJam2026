import type { PreferenceService } from "../services/preference.service.js";
import { eventMeta, type AgentEvent } from "./events.js";
import { parsePreferencePatch } from "./deterministic-parser.js";
import type { AgentRuntime, AgentTurnInput } from "./runtime.js";

/**
 * 沒有模型 API key 時的退路。它只做一件事：把訊息裡抓得到的條件寫進 preference state，
 * 然後讓前端依那份條件去排物件（見 app/api/agent/chat 的 preferences.updated）。
 *
 * 這裡不再呼叫行政區排名 —— 那一層已經移除，而且它的輸出（「推薦你考慮中山區」）
 * 正好是產品不想要的那種回答。
 */
export class DeterministicAgentRuntime implements AgentRuntime {
  readonly name = "deterministic-fallback";
  constructor(private readonly preferences: PreferenceService) {}

  async *runTurn(input: AgentTurnInput): AsyncIterable<AgentEvent> {
    const meta = () => eventMeta(input.turnId);
    yield { type: "message.started", ...meta() };

    const patch = parsePreferencePatch(input.message);
    let updated = false;
    if (patch) {
      yield { type: "tool.started", toolCallId: `${input.turnId}:preferences`, toolName: "update_preferences", arguments: patch, ...meta() };
      const session = await this.preferences.update(input.session.id, patch);
      yield { type: "preferences.updated", preferences: session.preferences, ...meta() };
      yield { type: "tool.completed", toolCallId: `${input.turnId}:preferences`, toolName: "update_preferences", isError: false, durationMs: 0, result: session.preferences, ...meta() };
      updated = true;
    } else {
      // 沒抓到條件也要推一次 state，前端才有觸發點去重排並更新畫面。
      const session = await this.preferences.update(input.session.id, {});
      yield { type: "preferences.updated", preferences: session.preferences, ...meta() };
    }

    const message = updated
      ? "目前沒有可用的模型服務，已用規則式解析把你這句話裡的條件寫進搜尋設定，右側是依這些條件排出的物件。若要更細的說明，請設定模型 API key 後再試。"
      : "目前沒有可用的模型服務，規則式解析沒有從這句話裡抓到可用的條件。可以直接說地區、預算、坪數或屋齡，例如「臺北市大安區，總價 2500 萬以內」。";
    yield { type: "message.delta", delta: message, ...meta() };
    yield { type: "message.completed", message, ...meta() };
  }
}
