import { loadConfig } from "../src/config/env.js";
import { createApplication } from "../src/composition-root.js";

const app = await createApplication(loadConfig({ NODE_ENV: "test", REPOSITORY_MODE: "memory", AGENT_MODE: "deterministic" }));
try {
  const created = await app.inject({ method: "POST", url: "/sessions", payload: {} });
  const sessionId = created.json().id as string;
  console.log(`Session: ${sessionId}`);
  for (const message of [
    "我想住在台灣中南部，月租最高 18000，希望不要太常下雨，而且附近生活機能要好。",
    "房價其實可以到 22000，但交通比生活機能重要，我希望附近最好有火車或捷運。",
  ]) {
    const response = await app.inject({ method: "POST", url: `/sessions/${sessionId}/messages`, payload: { message } });
    const body = response.json();
    console.log(`\nUser: ${message}`);
    console.log(body.session.conversation.at(-1)?.content);
    console.table(body.session.candidates.slice(0, 3).map((candidate: { city: string; district: string; score: number }) => ({ location: `${candidate.city}${candidate.district}`, score: candidate.score })));
  }
  const manual = await app.inject({ method: "PATCH", url: `/sessions/${sessionId}/preferences`, payload: { softPreferences: { climate: { weight: 1 } } } });
  console.log(`\nManual climate weight: ${manual.json().preferences.softPreferences.climate.weight}`);
  console.table(manual.json().candidates.slice(0, 3).map((candidate: { city: string; district: string; score: number }) => ({ location: `${candidate.city}${candidate.district}`, score: candidate.score })));
} finally {
  await app.close();
}

