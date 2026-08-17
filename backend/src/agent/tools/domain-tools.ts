import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { preferencePatchSchema, type PreferencePatch } from "../../domain/preferences/schema.js";
import { urbanPlanCitySchema } from "../../domain/urban-plan/schema.js";
import { ListingsUnavailableError, type ListingsProvider } from "../../providers/listings/index.js";
import type { ProviderRegistry } from "../../providers/types.js";
import type { UrbanPlanProvider } from "../../providers/urban-plan/types.js";
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
  urbanPlan: UrbanPlanProvider;
  listings: ListingsProvider;
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
      name: "get_urban_plan",
      label: "查詢都市計畫使用分區",
      description: [
        "以 WGS84 座標查真實的都市計畫圖資：使用分區、建蔽率、容積率、所屬都市計畫、細部計畫、都市計畫案、以及都市更新／山坡地／禁限建／都市設計審議等管制範圍。",
        "資料直接來自 臺北市 UPIS、新北市城鄉資訊查詢平台、基隆市 UPGIS 三個官方系統，只涵蓋這三個縣市；其他地區會回錯誤。",
        "回傳的 match 一定要看：parcel 表示座標就落在該分區圖形內；nearby 表示座標落在道路或河川等沒有分區圖形的地方，是用周邊半徑取的參考值，不能講成該地號的法定分區；none 表示查無資料。",
        "buildingCoveragePct／floorAreaRatioPct 為 null 就是來源沒有提供（基隆市圖資沒有這兩個欄位），不可自行推估。warnings 有內容時要一併說明。",
      ].join(""),
      parameters: Type.Object({
        latitude: Type.Number({ description: "WGS84 latitude in decimal degrees, e.g. 25.0478" }),
        longitude: Type.Number({ description: "WGS84 longitude in decimal degrees, e.g. 121.5637" }),
        city: Type.Optional(Type.String({ description: "臺北市 | 新北市 | 基隆市. Omit to resolve from the coordinate." })),
      }),
      execute: async (_id, params, signal) => {
        const { latitude, longitude, city } = params as { latitude: number; longitude: number; city?: string };
        const parsedCity = urbanPlanCitySchema.safeParse(city);
        if (city !== undefined && !parsedCity.success) {
          throw new Error(`city 只接受 臺北市、新北市、基隆市；收到「${city}」。省略 city 會依座標自動判斷。`);
        }
        return textResult(await deps.urbanPlan.lookup({
          latitude,
          longitude,
          ...(parsedCity.success ? { city: parsedCity.data } : {}),
        }, signal));
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
    {
      name: "rank_listings",
      label: "排名實際房屋物件",
      description:
        "用目前的 preference state 對物件資料庫排名，回傳可以直接向使用者推薦的實際房屋物件（含地址、價格、坪數、格局、屋齡、分數與貢獻最大的三個維度）。" +
        "這是回答「哪一間適合我」的唯一資料來源。分數由 deterministic scoring engine 產生，不得自行計算或改寫。" +
        "先呼叫 rank_candidates 選出行政區可以讓結果集中在較適合的區域，但不是必要前置。",
      parameters: Type.Object({
        mode: Type.Optional(Type.String({ description: "sale（買賣）或 rent（租賃）。省略時沿用預設。" })),
        limit: Type.Optional(Type.Number({ description: "回傳幾筆，1..20，預設 8。" })),
        useRankedDistricts: Type.Optional(Type.Boolean({
          description: "true（預設）時把已排名的前幾個行政區當成搜尋範圍；false 則不限行政區。",
        })),
      }),
      execute: async (_id, params, signal) => {
        const { mode, limit, useRankedDistricts } = params as {
          mode?: string; limit?: number; useRankedDistricts?: boolean;
        };
        if (mode !== undefined && mode !== "sale" && mode !== "rent") {
          throw new Error(`mode 只接受 "sale" 或 "rent"；收到「${mode}」。`);
        }
        const session = await deps.sessions.get(deps.sessionId);
        try {
          const result = await deps.listings.rank({
            sessionId: deps.sessionId,
            preferences: session.preferences,
            districts: useRankedDistricts === false ? [] : session.candidates,
            ...(mode ? { mode } : {}),
            ...(limit ? { limit } : {}),
            ...(signal ? { signal } : {}),
          });
          // 0 筆是常見且有意義的結果（條件太嚴），不是錯誤 —— 讓 agent 拿著
          // relaxations 去說明為什麼，而不是丟例外把整輪打斷。
          return textResult(result);
        } catch (error) {
          if (error instanceof ListingsUnavailableError) {
            return textResult({ error: error.message, listings: [], total: 0, relaxations: [] });
          }
          throw error;
        }
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
  "listingPreferences: fengshuiWeight (0..1), avoidFengshui[] — 物件層級，不影響行政區排名，前端拿去排物件。",
  "avoidFengshui only accepts: throughDraft 穿堂煞, stoveInSight 開門見灶, toiletFacingDoor 開門見廁,",
  "beamPressure 樑壓床, narrowHall 明堂狹窄, roadRush 路衝壁刀. It is a hard exclusion — see the fengshui rule in the system prompt.",
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
