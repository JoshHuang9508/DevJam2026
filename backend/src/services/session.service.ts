import { randomUUID } from "node:crypto";
import type { SessionRepository } from "../database/session-repository.js";
import { defaultPreferenceState } from "../domain/preferences/schema.js";
import type { SearchSession } from "../domain/sessions/schema.js";

export class SessionNotFoundError extends Error {
  constructor(id: string) { super(`Session ${id} was not found`); this.name = "SessionNotFoundError"; }
}

export class SessionService {
  constructor(private readonly repository: SessionRepository) {}
  async create(userId: string | null = null): Promise<SearchSession> {
    const now = new Date().toISOString();
    return this.repository.create({ id: randomUUID(), userId, preferences: structuredClone(defaultPreferenceState), conversation: [], candidates: [], rankingHistory: [], createdAt: now, updatedAt: now });
  }
  async get(id: string): Promise<SearchSession> { const session = await this.repository.get(id); if (!session) throw new SessionNotFoundError(id); return session; }
  async save(session: SearchSession): Promise<SearchSession> { return this.repository.save({ ...session, updatedAt: new Date().toISOString() }); }
  async close(): Promise<void> { await this.repository.close(); }
}

