import { randomUUID } from "node:crypto";
import type { Candidate, LocationBase } from "../domain/candidates/schema.js";
import { rankCandidates } from "../domain/ranking/engine.js";
import type { ProviderRegistry, ProviderResult } from "../providers/types.js";
import { SessionService } from "./session.service.js";

export class RecommendationService {
  constructor(private readonly sessions: SessionService, private readonly providers: ProviderRegistry) {}

  async searchAndRank(sessionId: string, signal?: AbortSignal): Promise<Candidate[]> {
    const session = await this.sessions.get(sessionId);
    const locations = await this.providers.locations.search(session.preferences, signal);
    const candidates = await Promise.all(locations.map((location) => this.hydrate(location, signal)));
    const result = rankCandidates(candidates, session.preferences);
    session.candidates = result.ranked;
    session.rankingHistory.push({ id: randomUUID(), preferenceVersion: session.preferences.version, candidates: structuredClone(result.ranked), createdAt: new Date().toISOString() });
    if (session.rankingHistory.length > 20) session.rankingHistory = session.rankingHistory.slice(-20);
    await this.sessions.save(session);
    return result.ranked;
  }

  async rerank(sessionId: string): Promise<Candidate[]> {
    const session = await this.sessions.get(sessionId);
    if (session.candidates.length === 0) return this.searchAndRank(sessionId);
    const result = rankCandidates(session.candidates, session.preferences);
    session.candidates = result.ranked;
    session.rankingHistory.push({ id: randomUUID(), preferenceVersion: session.preferences.version, candidates: structuredClone(result.ranked), createdAt: new Date().toISOString() });
    await this.sessions.save(session);
    return result.ranked;
  }

  async getCandidate(sessionId: string, candidateId: string): Promise<Candidate | null> {
    const session = await this.sessions.get(sessionId);
    return session.candidates.find((candidate) => candidate.id === candidateId) ?? null;
  }

  private async hydrate(location: LocationBase, signal?: AbortSignal): Promise<Candidate> {
    const [climate, housing, amenities, transportation, geography] = await Promise.all([
      safeProvider(() => this.providers.climate.getClimate(location, signal)),
      safeProvider(() => this.providers.housing.getHousingStats(location, signal)),
      safeProvider(() => this.providers.amenities.getAmenities(location, signal)),
      safeProvider(() => this.providers.transport.getTransport(location, signal)),
      safeProvider(() => this.providers.geography.getGeography(location, signal)),
    ]);
    const placeholder = (reason: string) => ({ rawScore: null, weight: 0, effectiveWeight: 0, contribution: 0, available: false, reason });
    return {
      ...location,
      rawData: { climate: climate.data, housing: housing.data, amenities: amenities.data, transportation: transportation.data, geography: geography.data },
      sources: { climate: climate.source, housing: housing.source, amenities: amenities.source, transportation: transportation.source, geography: geography.source },
      dataQuality: { climate: climate.quality, housing: housing.quality, amenities: amenities.quality, transportation: transportation.quality, geography: geography.quality },
      normalizedScores: { climate: null, housing: null, amenities: null, transportation: null, geography: null },
      score: 0,
      confidence: 0,
      scoreBreakdown: { climate: placeholder("not ranked"), housing: placeholder("not ranked"), amenities: placeholder("not ranked"), transportation: placeholder("not ranked"), geography: placeholder("not ranked") },
      highlights: [],
      tradeoffs: [],
    };
  }
}

async function safeProvider<T>(request: () => Promise<ProviderResult<T>>): Promise<ProviderResult<T>> {
  try { return await request(); } catch (error) { return { data: null, quality: "missing", source: null, warning: error instanceof Error ? error.message : "provider failed" }; }
}

