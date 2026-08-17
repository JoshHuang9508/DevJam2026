/**
 * Live check against the three cities' urban-planning GIS. Not part of `pnpm test` — it hits real
 * government servers, and 基隆市 alone takes ~20 seconds per uncached coordinate.
 *
 *   pnpm urban-plan:smoke
 */
import { loadConfig } from "../src/config/env.js";
import { createApplication } from "../src/composition-root.js";
import { createUrbanPlanProvider, UrbanPlanCoverageError } from "../src/providers/urban-plan/index.js";
import type { UrbanPlanCity } from "../src/domain/urban-plan/schema.js";

interface Probe {
  label: string;
  latitude: number;
  longitude: number;
  city?: UrbanPlanCity;
  /** What the endpoint verification showed, so a regression reads as a failure and not as news. */
  expect: { city: UrbanPlanCity; match?: "parcel" | "nearby" | "none" } | "coverage-error";
}

const probes: Probe[] = [
  { label: "臺北車站", latitude: 25.0478, longitude: 121.5637, expect: { city: "臺北市", match: "parcel" } },
  { label: "臺北 101（點位落在信義計畫區道路上）", latitude: 25.0330, longitude: 121.5645, expect: { city: "臺北市", match: "nearby" } },
  { label: "板橋車站", latitude: 25.0143, longitude: 121.4628, expect: { city: "新北市", match: "parcel" } },
  { label: "永和（在臺北市 bbox 內，實際屬新北市）", latitude: 25.0079, longitude: 121.5150, expect: { city: "新北市" } },
  { label: "新店行政園區", latitude: 24.9676, longitude: 121.5417, expect: { city: "新北市", match: "parcel" } },
  { label: "基隆車站", latitude: 25.1319, longitude: 121.7392, expect: { city: "基隆市", match: "parcel" } },
  { label: "基隆七堵", latitude: 25.0947, longitude: 121.7139, expect: { city: "基隆市" } },
  { label: "臺中西區（未接入的縣市）", latitude: 24.1430, longitude: 120.6710, expect: "coverage-error" },
];

const provider = createUrbanPlanProvider();
let failures = 0;

for (const probe of probes) {
  const startedAt = performance.now();
  try {
    const report = await provider.lookup({
      latitude: probe.latitude,
      longitude: probe.longitude,
      ...(probe.city ? { city: probe.city } : {}),
    });
    const elapsed = `${Math.round(performance.now() - startedAt)}ms`;
    if (probe.expect === "coverage-error") {
      failures += 1;
      console.log(`✗ ${probe.label}: 預期被拒絕，卻回傳了 ${report.city}`);
      continue;
    }
    const cityOk = report.city === probe.expect.city;
    const matchOk = probe.expect.match === undefined || report.match === probe.expect.match;
    if (!cityOk || !matchOk) failures += 1;
    const zone = report.zones[0];
    console.log(`${cityOk && matchOk ? "✓" : "✗"} ${probe.label} — ${report.city} / ${report.match} / ${elapsed}`);
    console.log(`    使用分區：${report.zones.map((item) => item.zoneName ?? "?").join("、") || "（無）"}`);
    console.log(`    建蔽率／容積率：${zone?.buildingCoveragePct ?? "—"}% / ${zone?.floorAreaRatioPct ?? "—"}%`);
    console.log(`    都市計畫：${report.urbanPlanName ?? "—"}｜細部計畫：${report.detailPlanNames.slice(0, 2).join("、") || "—"}`);
    console.log(`    都計案 ${report.planCases.length} 件${report.planCases[0] ? `（例：${report.planCases[0].planName}）` : ""}`);
    if (report.overlays.length > 0) console.log(`    管制範圍：${report.overlays.map((item) => item.name).join("、")}`);
    for (const warning of report.warnings) console.log(`    ⚠ ${warning}`);
  } catch (error: unknown) {
    const elapsed = `${Math.round(performance.now() - startedAt)}ms`;
    const expected = probe.expect === "coverage-error" && error instanceof UrbanPlanCoverageError;
    if (!expected) failures += 1;
    console.log(`${expected ? "✓" : "✗"} ${probe.label} — ${error instanceof Error ? error.message : String(error)} / ${elapsed}`);
  }
}

const cachedStart = performance.now();
await provider.lookup({ latitude: 25.1319, longitude: 121.7392 });
console.log(`\n快取重查基隆車站：${Math.round(performance.now() - cachedStart)}ms`);

// The HTTP surface, including its response schema and the two rejection paths.
const app = await createApplication(loadConfig({ NODE_ENV: "test", REPOSITORY_MODE: "memory", AGENT_MODE: "deterministic" }));
const checkRoute = async (label: string, payload: Record<string, unknown>, expectedStatus: number) => {
  const response = await app.inject({ method: "POST", url: "/urban-plan", payload });
  const ok = response.statusCode === expectedStatus;
  if (!ok) failures += 1;
  const parsed = JSON.parse(response.body) as { city?: string; match?: string; message?: string };
  console.log(`${ok ? "✓" : "✗"} POST /urban-plan ${label} — ${response.statusCode}｜${parsed.city ? `${parsed.city} / ${parsed.match}` : parsed.message ?? response.body.slice(0, 80)}`);
};
console.log("");
await checkRoute("臺北車站", { latitude: 25.0478, longitude: 121.5637 }, 200);
await checkRoute("指定城市", { latitude: 25.1319, longitude: 121.7392, city: "基隆市" }, 200);
await checkRoute("未接入的縣市", { latitude: 24.143, longitude: 120.671 }, 400);
await checkRoute("座標超出台灣範圍", { latitude: 48.85, longitude: 2.35 }, 400);
await app.close();

console.log(failures === 0 ? "\n全部通過" : `\n${failures} 項未達預期`);
process.exit(failures === 0 ? 0 : 1);
