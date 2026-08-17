import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createApplication } from "../src/composition-root.js";

describe("acceptance flow", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await createApplication(loadConfig({ NODE_ENV: "test", REPOSITORY_MODE: "memory", AGENT_MODE: "deterministic" }));
  });
  afterEach(async () => app.close());

  it("keeps state across two messages and manual slider adjustment", async () => {
    const created = await app.inject({ method: "POST", url: "/sessions", payload: {} });
    expect(created.statusCode).toBe(201);
    const sessionId = created.json().id as string;

    const turn1 = await app.inject({ method: "POST", url: `/sessions/${sessionId}/messages`, payload: { message: "我想住在台灣中南部，月租最高 18000，希望不要太常下雨，而且附近生活機能要好。" } });
    expect(turn1.statusCode).toBe(200);
    const afterTurn1 = turn1.json().session;
    expect(afterTurn1.preferences.hardConstraints.maxMonthlyRent).toBe(18_000);
    expect(afterTurn1.preferences.hardConstraints.regions).toEqual(["中部", "南部"]);
    expect(afterTurn1.preferences.softPreferences.climate.rainfall.preference).toBe("low");
    expect(afterTurn1.candidates.length).toBeGreaterThan(0);
    expect(afterTurn1.candidates[0].latitude).toBeTypeOf("number");

    const turn2 = await app.inject({ method: "POST", url: `/sessions/${sessionId}/messages`, payload: { message: "房價其實可以到 22000，但交通比生活機能重要，我希望附近最好有火車或捷運。" } });
    expect(turn2.statusCode).toBe(200);
    const afterTurn2 = turn2.json().session;
    expect(afterTurn2.preferences.hardConstraints.maxMonthlyRent).toBe(22_000);
    expect(afterTurn2.preferences.softPreferences.transportation.weight).toBeGreaterThan(afterTurn2.preferences.softPreferences.amenities.weight);
    expect(afterTurn2.preferences.softPreferences.climate.rainfall.preference).toBe("low");
    expect(afterTurn2.conversation).toHaveLength(4);

    const manual = await app.inject({ method: "PATCH", url: `/sessions/${sessionId}/preferences`, payload: { softPreferences: { climate: { weight: 1 } } } });
    expect(manual.statusCode).toBe(200);
    expect(manual.json().preferences.softPreferences.climate.weight).toBe(1);
    expect(manual.json().candidates.length).toBeGreaterThan(0);

    const final = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
    expect(final.json().preferences.softPreferences.climate.weight).toBe(1);
    expect(final.json().rankingHistory.length).toBeGreaterThanOrEqual(3);
  });

  it("turns a fengshui sentence into listing-level state without disturbing the ranking axes", async () => {
    // 端到端證明風水接線真的接上了：前端已經沒有自己的萃取器，這條路徑是唯一的入口。
    const created = await app.inject({ method: "POST", url: "/sessions", payload: {} });
    const sessionId = created.json().id as string;
    const baseline = created.json().preferences;
    expect(baseline.listingPreferences).toEqual({ fengshuiWeight: 0, avoidFengshui: [] });

    const turn = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/messages`,
      payload: { message: "預算 2500 萬以內，很在意風水，不要穿堂煞和樑壓床，要有電梯" },
    });
    expect(turn.statusCode).toBe(200);
    const preferences = turn.json().session.preferences;

    expect(preferences.listingPreferences.fengshuiWeight).toBeGreaterThan(0);
    expect(preferences.listingPreferences.avoidFengshui).toEqual(["throughDraft", "beamPressure"]);
    // 行政區排序的五維不該因為一句風水而位移，也不該長出第六維。
    expect(preferences.softPreferences).toEqual(baseline.softPreferences);
    expect(turn.json().session.candidates.length).toBeGreaterThan(0);
  });

  it("streams typed SSE events", async () => {
    const created = await app.inject({ method: "POST", url: "/sessions", payload: {} });
    const response = await app.inject({ method: "POST", url: `/sessions/${created.json().id}/messages`, headers: { accept: "text/event-stream" }, payload: { message: "南部月租最高 18000，希望少雨" } });
    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain("event: message.started");
    expect(response.payload).toContain("event: preferences.updated");
    expect(response.payload).toContain("event: ranking.updated");
    expect(response.payload).toContain("event: message.completed");
  });

  it("publishes OpenAPI and rejects invalid weights", async () => {
    const spec = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(spec.statusCode).toBe(200);
    expect(spec.json().paths["/sessions/{id}/messages"]).toBeDefined();
    const created = await app.inject({ method: "POST", url: "/sessions", payload: {} });
    const invalid = await app.inject({ method: "PATCH", url: `/sessions/${created.json().id}/preferences`, payload: { softPreferences: { climate: { weight: 2 } } } });
    expect(invalid.statusCode).toBe(400);
  });
});

