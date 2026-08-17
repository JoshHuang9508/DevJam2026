export interface BackendHealth {
  status: "ok";
  runtime: string;
}

export interface ConversationMessage {
  id: string;
  turnId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface RankingSnapshot {
  id: string;
  preferenceVersion: number;
  candidates: Candidate[];
  createdAt: string;
}

export interface Candidate {
  id: string;
  region: string;
  city: string;
  district: string;
  latitude: number;
  longitude: number;
  score: number;
  confidence: number;
  highlights: string[];
  tradeoffs: string[];
  [key: string]: unknown;
}

export interface SearchSession {
  id: string;
  userId: string | null;
  preferences: Record<string, unknown>;
  conversation: ConversationMessage[];
  candidates: Candidate[];
  rankingHistory: RankingSnapshot[];
  createdAt: string;
  updatedAt: string;
}

interface EventBase {
  turnId: string;
  timestamp: string;
}

export type AgentEvent =
  | (EventBase & { type: "message.started" })
  | (EventBase & { type: "message.delta"; delta: string })
  | (EventBase & {
      type: "message.completed";
      message: string;
      model?: string;
      usage?: { input: number; output: number; totalTokens: number; costUsd: number };
    })
  | (EventBase & { type: "thinking.started" })
  | (EventBase & { type: "thinking.delta"; delta: string })
  | (EventBase & { type: "thinking.completed"; thinking: string })
  | (EventBase & { type: "tool.started"; toolCallId: string; toolName: string; arguments: unknown })
  | (EventBase & { type: "tool.completed"; toolCallId: string; toolName: string; isError: boolean; durationMs: number; result?: unknown })
  | (EventBase & { type: "preferences.updated"; preferences: Record<string, unknown> })
  | (EventBase & { type: "candidates.updated"; candidates: Candidate[] })
  | (EventBase & { type: "ranking.updated"; candidates: Candidate[] })
  | (EventBase & { type: "error"; code: string; message: string; recoverable: boolean });

export interface ToolBlock {
  kind: "tool";
  id: string;
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  result?: unknown;
  isError?: boolean;
  durationMs?: number;
  status: "running" | "done" | "error";
}

export interface ThinkingBlock {
  kind: "thinking";
  id: string;
  text: string;
  done: boolean;
}

export interface TextBlock {
  kind: "text";
  id: string;
  text: string;
  done: boolean;
}

export type AssistantBlock = ThinkingBlock | ToolBlock | TextBlock;

export interface UserChat {
  kind: "user";
  id: string;
  content: string;
  createdAt?: string;
}

export interface AssistantChat {
  kind: "assistant";
  id: string;
  turnId: string;
  blocks: AssistantBlock[];
  model?: string;
  usage?: { input: number; output: number; totalTokens: number; costUsd: number };
  error?: string;
  done: boolean;
}

export type ChatItem = UserChat | AssistantChat;

export interface LoggedEvent {
  id: string;
  receivedAt: string;
  event: AgentEvent;
}
