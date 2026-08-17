import { Agent, type AgentEvent as PiEvent } from "@earendil-works/pi-agent-core";
import { contentText } from "@earendil-works/pi-ai";
import type { ListingsProvider } from "../providers/listings/index.js";
import type { ProviderRegistry } from "../providers/types.js";
import type { UrbanPlanProvider } from "../providers/urban-plan/types.js";
import type { PreferenceService } from "../services/preference.service.js";
import type { RecommendationService } from "../services/recommendation.service.js";
import type { SessionService } from "../services/session.service.js";
import { AsyncQueue } from "../lib/async-queue.js";
import { eventMeta, type AgentEvent } from "./events.js";
import { AGENT_SYSTEM_PROMPT, buildTurnPrompt } from "./prompt.js";
import type { AgentRuntime, AgentTurnInput } from "./runtime.js";
import { createDomainTools } from "./tools/domain-tools.js";
import { createConfiguredModels, type PiModelProviderConfig } from "./model-provider.js";

interface PiRuntimeOptions extends PiModelProviderConfig {
  sessions: SessionService;
  preferences: PreferenceService;
  recommendations: RecommendationService;
  providers: ProviderRegistry;
  urbanPlan: UrbanPlanProvider;
  listings: ListingsProvider;
}

export class PiAgentRuntime implements AgentRuntime {
  readonly name = "pi-agent-core";
  constructor(private readonly options: PiRuntimeOptions) {}

  runTurn(input: AgentTurnInput): AsyncIterable<AgentEvent> {
    const queue = new AsyncQueue<AgentEvent>();
    const { models, model } = createConfiguredModels(this.options);
    const tools = createDomainTools({
      sessionId: input.session.id,
      turnId: input.turnId,
      sessions: this.options.sessions,
      preferences: this.options.preferences,
      recommendations: this.options.recommendations,
      providers: this.options.providers,
      urbanPlan: this.options.urbanPlan,
      listings: this.options.listings,
      publish: (event) => queue.push(event),
    });
    const agent = new Agent({
      initialState: { systemPrompt: AGENT_SYSTEM_PROMPT, model, tools, thinkingLevel: model.reasoning ? "low" : "off" },
      streamFn: models.streamSimple.bind(models),
      sessionId: input.session.id,
      getApiKey: () => this.options.apiKey,
      toolExecution: "parallel",
    });
    const started = new Map<string, number>();
    let messageStarted = false;
    let streamedThinking = false;
    agent.subscribe((event) => this.forwardEvent(event, input.turnId, queue, started, {
      getMessageStarted: () => messageStarted,
      setMessageStarted: () => { messageStarted = true; },
      getStreamedThinking: () => streamedThinking,
      setStreamedThinking: () => { streamedThinking = true; },
    }));
    void agent.prompt(buildTurnPrompt(input.session, input.message)).catch((error: unknown) => {
      queue.push({ type: "error", code: "PI_RUNTIME_FAILED", message: error instanceof Error ? error.message : String(error), recoverable: true, ...eventMeta(input.turnId) });
      queue.end();
    });
    if (input.signal) input.signal.addEventListener("abort", () => agent.abort(), { once: true });
    return queue;
  }

  private forwardEvent(
    event: PiEvent,
    turnId: string,
    queue: AsyncQueue<AgentEvent>,
    started: Map<string, number>,
    flags: {
      getMessageStarted: () => boolean;
      setMessageStarted: () => void;
      getStreamedThinking: () => boolean;
      setStreamedThinking: () => void;
    },
  ): void {
    const meta = () => eventMeta(turnId);
    if (event.type === "message_start" && event.message.role === "assistant" && !flags.getMessageStarted()) {
      flags.setMessageStarted();
      queue.push({ type: "message.started", ...meta() });
    } else if (event.type === "message_update") {
      const inner = event.assistantMessageEvent;
      if (inner.type === "text_delta") queue.push({ type: "message.delta", delta: inner.delta, ...meta() });
      else if (inner.type === "thinking_start") {
        flags.setStreamedThinking();
        queue.push({ type: "thinking.started", ...meta() });
      } else if (inner.type === "thinking_delta") {
        flags.setStreamedThinking();
        queue.push({ type: "thinking.delta", delta: inner.delta, ...meta() });
      } else if (inner.type === "thinking_end") {
        flags.setStreamedThinking();
        queue.push({ type: "thinking.completed", thinking: inner.content, ...meta() });
      }
    } else if (event.type === "message_end" && event.message.role === "assistant") {
      const thinking = event.message.content
        .filter((block): block is { type: "thinking"; thinking: string } => block.type === "thinking")
        .map((block) => block.thinking)
        .filter(Boolean)
        .join("\n");
      if (thinking && !flags.getStreamedThinking()) {
        flags.setStreamedThinking();
        queue.push({ type: "thinking.started", ...meta() });
        queue.push({ type: "thinking.completed", thinking, ...meta() });
      }
      if (!event.message.content.some((block) => block.type === "toolCall")) {
        queue.push({
          type: "message.completed",
          message: contentText(event.message.content),
          model: event.message.model,
          usage: { input: event.message.usage.input, output: event.message.usage.output, totalTokens: event.message.usage.totalTokens, costUsd: event.message.usage.cost.total },
          ...meta(),
        });
      }
    } else if (event.type === "tool_execution_start") {
      started.set(event.toolCallId, performance.now());
      queue.push({ type: "tool.started", toolCallId: event.toolCallId, toolName: event.toolName, arguments: event.args, ...meta() });
    } else if (event.type === "tool_execution_end") {
      queue.push({
        type: "tool.completed",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
        durationMs: Math.round(performance.now() - (started.get(event.toolCallId) ?? performance.now())),
        result: unwrapToolResult(event.result),
        ...meta(),
      });
    } else if (event.type === "turn_end" && event.message.role === "assistant" && event.message.errorMessage) {
      queue.push({ type: "error", code: "MODEL_ERROR", message: event.message.errorMessage, recoverable: true, ...meta() });
    } else if (event.type === "agent_end") {
      queue.end();
    }
  }
}

function unwrapToolResult(result: unknown): unknown {
  if (result && typeof result === "object" && "details" in result) return (result as { details: unknown }).details;
  return result;
}
