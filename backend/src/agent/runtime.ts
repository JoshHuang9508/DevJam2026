import type { SearchSession } from "../domain/sessions/schema.js";
import type { AgentEvent } from "./events.js";

export interface AgentTurnInput {
  session: SearchSession;
  turnId: string;
  message: string;
  signal?: AbortSignal;
}

export interface AgentRuntime {
  readonly name: string;
  runTurn(input: AgentTurnInput): AsyncIterable<AgentEvent>;
}

