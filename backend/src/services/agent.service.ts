import { randomUUID } from "node:crypto";
import type { AgentRuntime } from "../agent/runtime.js";
import type { AgentEvent } from "../agent/events.js";
import { SessionService } from "./session.service.js";

export class AgentService {
  constructor(private readonly sessions: SessionService, private readonly runtime: AgentRuntime) {}

  async *runTurn(sessionId: string, message: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const turnId = randomUUID();
    const session = await this.sessions.get(sessionId);
    session.conversation.push({ id: randomUUID(), turnId, role: "user", content: message, createdAt: new Date().toISOString() });
    await this.sessions.save(session);
    let assistantMessage = "";
    const input = signal ? { session, turnId, message, signal } : { session, turnId, message };
    for await (const event of this.runtime.runTurn(input)) {
      if (event.type === "message.completed") assistantMessage = event.message;
      yield event;
    }
    if (assistantMessage) {
      const latest = await this.sessions.get(sessionId);
      latest.conversation.push({ id: randomUUID(), turnId, role: "assistant", content: assistantMessage, createdAt: new Date().toISOString() });
      await this.sessions.save(latest);
    }
  }
}

