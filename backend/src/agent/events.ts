import { z } from "zod";
import { candidateSchema } from "../domain/candidates/schema.js";
import { preferenceStateSchema } from "../domain/preferences/schema.js";

const eventBase = z.object({ turnId: z.string().uuid(), timestamp: z.string().datetime() });

export const agentEventSchema = z.discriminatedUnion("type", [
  eventBase.extend({ type: z.literal("message.started") }),
  eventBase.extend({ type: z.literal("message.delta"), delta: z.string() }),
  eventBase.extend({
    type: z.literal("message.completed"),
    message: z.string(),
    model: z.string().optional(),
    usage: z.object({ input: z.number().nonnegative(), output: z.number().nonnegative(), totalTokens: z.number().nonnegative(), costUsd: z.number().nonnegative() }).optional(),
  }),
  eventBase.extend({ type: z.literal("thinking.started") }),
  eventBase.extend({ type: z.literal("thinking.delta"), delta: z.string() }),
  eventBase.extend({ type: z.literal("thinking.completed"), thinking: z.string() }),
  eventBase.extend({ type: z.literal("tool.started"), toolCallId: z.string(), toolName: z.string(), arguments: z.unknown() }),
  eventBase.extend({ type: z.literal("tool.completed"), toolCallId: z.string(), toolName: z.string(), isError: z.boolean(), durationMs: z.number().nonnegative(), result: z.unknown().optional() }),
  eventBase.extend({ type: z.literal("preferences.updated"), preferences: preferenceStateSchema }),
  eventBase.extend({ type: z.literal("candidates.updated"), candidates: z.array(candidateSchema) }),
  eventBase.extend({ type: z.literal("ranking.updated"), candidates: z.array(candidateSchema) }),
  eventBase.extend({ type: z.literal("error"), code: z.string(), message: z.string(), recoverable: z.boolean() }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;

export function eventMeta(turnId: string): Pick<AgentEvent, "turnId" | "timestamp"> {
  return { turnId, timestamp: new Date().toISOString() };
}
