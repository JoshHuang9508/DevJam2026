import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { preferencePatchSchema, type PreferencePatch } from "../../domain/preferences/schema.js";
import type { ProviderRegistry } from "../../providers/types.js";
import type { PreferenceService } from "../../services/preference.service.js";
import type { RecommendationService } from "../../services/recommendation.service.js";
import type { SessionService } from "../../services/session.service.js";
import type { AgentEvent } from "../events.js";
import { eventMeta } from "../events.js";

interface ToolDependencies {
  sessionId: string;
  turnId: string;
  sessions: SessionService;
  preferences: PreferenceService;
  recommendations: RecommendationService;
  providers: ProviderRegistry;
  publish: (event: AgentEvent) => void;
}

export function createDomainTools(deps: ToolDependencies): AgentTool<any>[] {
  const textResult = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }], details: data });
  const locationParams = Type.Object({ locationId: Type.String({ description: "Candidate administrative district id from search_locations" }) });
  const resolveLocation = async (locationId: string, signal?: AbortSignal) => {
    const location = await deps.providers.locations.get(locationId, signal);
    if (!location) throw new Error(`Unknown Taiwan location id: ${locationId}`);
    return location;
  };

  return [
    {
      name: "search_locations", label: "搜尋台灣候選行政區", description: "依 persistent preference state 和 hard constraints 搜尋台灣縣市/鄉鎮市區候選。",
      parameters: Type.Object({}),
      execute: async (_id, _params, signal) => {
        const session = await deps.sessions.get(deps.sessionId);
        return textResult(await deps.providers.locations.search(session.preferences, signal));
      },
    },
    providerTool("get_climate", "取得氣候", "取得行政區氣候 fixture/public provider 資料與 source metadata。", locationParams, async (id, signal) => deps.providers.climate.getClimate(await resolveLocation(id, signal), signal), textResult),
    providerTool("get_housing", "取得租金", "取得行政區租金統計與 source metadata；不得當作即時房源。", locationParams, async (id, signal) => deps.providers.housing.getHousingStats(await resolveLocation(id, signal), signal), textResult),
    providerTool("get_amenities", "取得生活機能", "取得行政區 POI 密度型生活機能資料。", locationParams, async (id, signal) => deps.providers.amenities.getAmenities(await resolveLocation(id, signal), signal), textResult),
    providerTool("get_transport", "取得交通", "取得臺鐵、高鐵、捷運距離與公車密度資料。", locationParams, async (id, signal) => deps.providers.transport.getTransport(await resolveLocation(id, signal), signal), textResult),
    providerTool("get_geography", "取得地理", "取得座標、海岸距離、海拔與都市密度 proxy。", locationParams, async (id, signal) => deps.providers.geography.getGeography(await resolveLocation(id, signal), signal), textResult),
    {
      name: "update_preferences", label: "更新偏好", description: "將使用者的 hard constraints 或 soft preference 變更寫入同一份 persistent state。patch 必須符合 PreferencePatch。",
      parameters: Type.Object({ patch: Type.Any({ description: PATCH_SHAPE }) }),
      executionMode: "sequential",
      execute: async (_id, params) => {
        const { patch } = params as { patch: PreferencePatch };
        // The patch is Type.Any, so the model has no schema to follow and can nest
        // fields that do not exist. Zod strips those silently, which would make a
        // no-op look successful; report them so the model can correct itself.
        const ignored = unknownPatchPaths(patch);
        const session = await deps.preferences.update(deps.sessionId, patch);
        deps.publish({ type: "preferences.updated", preferences: session.preferences, ...eventMeta(deps.turnId) });
        return textResult(ignored.length === 0 ? session.preferences : {
          preferences: session.preferences,
          warning: `這些欄位不存在於 PreferencePatch，已被忽略且未生效：${ignored.join("、")}。請改用下列合法路徑重送。`,
          validPaths: PATCH_SHAPE,
        });
      },
    },
    {
      name: "rank_candidates", label: "計算候選排名", description: "呼叫 deterministic recommendation engine。所有最終分數只能由此工具產生。",
      parameters: Type.Object({ refreshData: Type.Optional(Type.Boolean({ description: "true to regenerate and hydrate candidates; defaults true" })) }),
      executionMode: "sequential",
      execute: async (_id, params, signal) => {
        const { refreshData } = params as { refreshData?: boolean };
        const candidates = refreshData === false ? await deps.recommendations.rerank(deps.sessionId) : await deps.recommendations.searchAndRank(deps.sessionId, signal);
        deps.publish({ type: "candidates.updated", candidates, ...eventMeta(deps.turnId) });
        deps.publish({ type: "ranking.updated", candidates, ...eventMeta(deps.turnId) });
        return textResult(candidates);
      },
    },
    {
      name: "get_candidate_detail", label: "取得候選詳情", description: "取得單一已排名行政區的完整 raw data、來源、breakdown 與 data quality。",
      parameters: locationParams,
      execute: async (_id, params) => {
        const { locationId } = params as { locationId: string };
        const candidate = await deps.recommendations.getCandidate(deps.sessionId, locationId);
        if (!candidate) throw new Error(`Candidate ${locationId} has not been ranked`);
        return textResult(candidate);
      },
    },
  ];
}

/** Canonical PreferencePatch paths. hardConstraints is flat — it has no per-dimension nesting. */
const PATCH_SHAPE = [
  "hardConstraints: regions[] (北部|中部|南部|東部|離島), cities[], districts[], excludedCities[], excludedDistricts[],",
  "minMonthlyRent, maxMonthlyRent, maxCommuteMinutes — all flat, never nested under housing/transportation.",
  "softPreferences.housing: weight, preferLowerRent.",
  "softPreferences.climate: weight, temperature{preferredMin,preferredMax,weight}, rainfall{preference:low|medium|high,weight}, humidity{preference,weight}.",
  "softPreferences.transportation: weight, railwayAccess, highSpeedRailAccess, mrtAccess, busAccess.",
  "softPreferences.amenities: weight, convenienceStore, supermarket, hospital, clinic, restaurant, school, park.",
  "softPreferences.geography: weight, urbanDensity, elevation, coastalPreference (-1..1).",
  "Every weight is 0..1. Omit whatever the user did not mention.",
].join(" ");

/** Paths present in the model's patch that the schema strips, i.e. silently ignored. */
function unknownPatchPaths(patch: unknown): string[] {
  const parsed = preferencePatchSchema.safeParse(patch);
  if (!parsed.success) return [];
  const ignored: string[] = [];
  const walk = (input: unknown, accepted: unknown, prefix: string): void => {
    if (!isPlainObject(input)) return;
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (!isPlainObject(accepted) || !(key in accepted)) { ignored.push(path); continue; }
      walk(value, accepted[key], path);
    }
  };
  walk(patch, parsed.data, "");
  return ignored;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerTool(
  name: string,
  label: string,
  description: string,
  parameters: ReturnType<typeof Type.Object>,
  request: (locationId: string, signal?: AbortSignal) => Promise<unknown>,
  textResult: (data: unknown) => { content: Array<{ type: "text"; text: string }>; details: unknown },
): AgentTool<any> {
  return { name, label, description, parameters, execute: async (_id, params, signal) => textResult(await request(String((params as { locationId: string }).locationId), signal)) };
}
