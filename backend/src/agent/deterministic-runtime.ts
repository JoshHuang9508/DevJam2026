import type { PreferenceService } from "../services/preference.service.js";
import type { RecommendationService } from "../services/recommendation.service.js";
import { eventMeta, type AgentEvent } from "./events.js";
import { parsePreferencePatch } from "./deterministic-parser.js";
import type { AgentRuntime, AgentTurnInput } from "./runtime.js";

export class DeterministicAgentRuntime implements AgentRuntime {
  readonly name = "deterministic-fallback";
  constructor(private readonly preferences: PreferenceService, private readonly recommendations: RecommendationService) {}

  async *runTurn(input: AgentTurnInput): AsyncIterable<AgentEvent> {
    const meta = () => eventMeta(input.turnId);
    yield { type: "message.started", ...meta() };
    const patch = parsePreferencePatch(input.message);
    if (patch) {
      yield { type: "tool.started", toolCallId: `${input.turnId}:preferences`, toolName: "update_preferences", arguments: patch, ...meta() };
      const session = await this.preferences.update(input.session.id, patch);
      yield { type: "preferences.updated", preferences: session.preferences, ...meta() };
      yield { type: "tool.completed", toolCallId: `${input.turnId}:preferences`, toolName: "update_preferences", isError: false, durationMs: 0, result: session.preferences, ...meta() };
    }
    yield { type: "tool.started", toolCallId: `${input.turnId}:rank`, toolName: "rank_candidates", arguments: {}, ...meta() };
    const candidates = await this.recommendations.searchAndRank(input.session.id, input.signal);
    yield { type: "candidates.updated", candidates, ...meta() };
    yield { type: "ranking.updated", candidates, ...meta() };
    yield { type: "tool.completed", toolCallId: `${input.turnId}:rank`, toolName: "rank_candidates", isError: false, durationMs: 0, result: candidates, ...meta() };
    const message = explain(candidates);
    yield { type: "message.delta", delta: message, ...meta() };
    yield { type: "message.completed", message, ...meta() };
  }
}

function explain(candidates: Awaited<ReturnType<RecommendationService["searchAndRank"]>>): string {
  if (!candidates.length) return "目前沒有符合所有硬條件的候選行政區。可以放寬租金上限或地區範圍後再試一次。";
  const summaries = candidates.slice(0, 3).map((candidate, index) => `${index + 1}. ${candidate.city}${candidate.district} ${candidate.score} 分：${candidate.highlights.join("、")}；取捨是 ${candidate.tradeoffs.join("、")}。`);
  return `依目前權重重新計算後：\n${summaries.join("\n")}\n目前使用的是可替換的開發 fixture 資料，不是即時房源或正式統計；分數由 deterministic ranking engine 計算。`;
}

