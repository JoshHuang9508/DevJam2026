import type { AssistantChat, ChatItem, SearchSession } from "./types";

let seq = 0;
export function uid(prefix = "id"): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export function sessionToChat(session: SearchSession): ChatItem[] {
  return session.conversation.map((message) => {
    if (message.role === "user") {
      return { kind: "user" as const, id: message.id, content: message.content, createdAt: message.createdAt };
    }
    return {
      kind: "assistant" as const,
      id: message.id,
      turnId: message.turnId,
      blocks: [{ kind: "text" as const, id: uid("text"), text: message.content, done: true }],
      done: true,
    };
  });
}

export function emptyAssistant(turnId: string): AssistantChat {
  return { kind: "assistant", id: uid("asst"), turnId, blocks: [], done: false };
}
