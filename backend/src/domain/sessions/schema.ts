import { z } from "zod";
import { candidateSchema } from "../candidates/schema.js";
import { preferenceStateSchema } from "../preferences/schema.js";

export const conversationMessageSchema = z.object({
  id: z.string().uuid(),
  turnId: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.string().datetime(),
});

export const rankingSnapshotSchema = z.object({
  id: z.string().uuid(),
  preferenceVersion: z.number().int().positive(),
  candidates: z.array(candidateSchema),
  createdAt: z.string().datetime(),
});

export const searchSessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().max(200).nullable(),
  preferences: preferenceStateSchema,
  conversation: z.array(conversationMessageSchema),
  candidates: z.array(candidateSchema),
  rankingHistory: z.array(rankingSnapshotSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type RankingSnapshot = z.infer<typeof rankingSnapshotSchema>;
export type SearchSession = z.infer<typeof searchSessionSchema>;

