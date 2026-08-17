import { describe, expect, it } from "vitest";
import { InMemorySessionRepository } from "../src/database/session-repository.js";
import { applyPreferencePatch } from "../src/domain/preferences/schema.js";
import { createFixtureProviders } from "../src/providers/fixture/fixture-provider.js";
import { RecommendationService } from "../src/services/recommendation.service.js";
import { SessionService } from "../src/services/session.service.js";

describe("deterministic ranking", () => {
  it("filters hard rent constraints and returns explainable 0..100 scores", async () => {
    const sessions = new SessionService(new InMemorySessionRepository());
    const session = await sessions.create();
    session.preferences = applyPreferencePatch(session.preferences, { hardConstraints: { regions: ["南部"], maxMonthlyRent: 15_000 } });
    await sessions.save(session);
    const candidates = await new RecommendationService(sessions, createFixtureProviders()).searchAndRank(session.id);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => (candidate.rawData.housing?.medianMonthlyRent ?? Infinity) <= 15_000)).toBe(true);
    expect(candidates.every((candidate) => candidate.score >= 0 && candidate.score <= 100)).toBe(true);
    expect(candidates[0]?.scoreBreakdown.housing.contribution).toBeGreaterThanOrEqual(0);
  });

  it("redistributes missing feature weight instead of crashing", async () => {
    const sessions = new SessionService(new InMemorySessionRepository());
    const session = await sessions.create();
    const recommendations = new RecommendationService(sessions, createFixtureProviders());
    const initial = await recommendations.searchAndRank(session.id);
    const latest = await sessions.get(session.id);
    latest.candidates = initial.map((candidate, index) => index === 0 ? { ...candidate, rawData: { ...candidate.rawData, climate: null }, dataQuality: { ...candidate.dataQuality, climate: "missing" } } : candidate);
    await sessions.save(latest);
    const reranked = await recommendations.rerank(session.id);
    const missing = reranked.find((candidate) => candidate.id === initial[0]?.id);
    expect(missing?.scoreBreakdown.climate.available).toBe(false);
    expect(missing?.scoreBreakdown.climate.effectiveWeight).toBe(0);
    expect(missing?.confidence).toBe(0.8);
  });
});

