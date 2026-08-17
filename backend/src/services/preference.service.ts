import type { PreferencePatch } from "../domain/preferences/schema.js";
import { applyPreferencePatch } from "../domain/preferences/schema.js";
import type { SearchSession } from "../domain/sessions/schema.js";
import { SessionService } from "./session.service.js";

export class PreferenceService {
  constructor(private readonly sessions: SessionService) {}
  async update(sessionId: string, patch: PreferencePatch): Promise<SearchSession> {
    const session = await this.sessions.get(sessionId);
    session.preferences = applyPreferencePatch(session.preferences, patch);
    return this.sessions.save(session);
  }
}

