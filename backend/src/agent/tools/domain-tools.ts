import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { preferencePatchSchema, type PreferencePatch } from "../../domain/preferences/schema.js";
import { urbanPlanCitySchema } from "../../domain/urban-plan/schema.js";
import { ListingsUnavailableError, type ListingsProvider } from "../../providers/listings/index.js";
import type { UrbanPlanProvider } from "../../providers/urban-plan/types.js";
import type { PreferenceService } from "../../services/preference.service.js";
import type { SessionService } from "../../services/session.service.js";
import type { AgentEvent } from "../events.js";
import { eventMeta } from "../events.js";

interface ToolDependencies {
  sessionId: string;
  turnId: string;
  sessions: SessionService;
  preferences: PreferenceService;
  urbanPlan: UrbanPlanProvider;
  listings: ListingsProvider;
  publish: (event: AgentEvent) => void;
}

/**
 * Agent 的工具集：**只剩物件資料集與都市計畫圖資**。
 *
 * 行政區推薦（search_locations / rank_candidates / get_candidate_detail 與五個
 * fixture provider）已經移除。理由是它們回答的是「哪一區比較好」，而使用者問的是
 * 「哪一間適合我」；那一層還會用 fixture 的區級統計去補話，講出來的數字跟畫面上
 * 卡片依據的物件資料集根本不是同一份。現在唯一的事實來源是物件資料集本身。
 */
export function createDomainTools(deps: ToolDependencies): AgentTool<any>[] {
  const textResult = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }], details: data });

  return [
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
      name: "describe_dataset",
      label: "查詢物件資料集涵蓋範圍",
      description:
        "回傳物件資料集實際涵蓋哪些縣市與行政區、各有幾筆、價格與坪數中位數。" +
        "被問到某個地方有沒有資料、或 rank_listings 回 0 筆時，**先呼叫這個**再回答：" +
        "0 筆的原因是「條件太嚴」還是「資料集沒有那個地方」，給使用者的建議完全不同。",
      parameters: Type.Object({
        mode: Type.Optional(Type.String({ description: "sale（買賣）或 rent（租賃）。省略時為 sale。" })),
      }),
      execute: async (_id, params, signal) => {
        const { mode } = params as { mode?: string };
        if (mode !== undefined && mode !== "sale" && mode !== "rent") {
          throw new Error(`mode 只接受 "sale" 或 "rent"；收到「${mode}」。`);
        }
        try {
          return textResult(await deps.listings.describe(mode ?? "sale", signal));
        } catch (error) {
          if (error instanceof ListingsUnavailableError) return textResult({ error: error.message });
          throw error;
        }
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
      name: "rank_listings",
      label: "排名實際房屋物件",
      description:
        "用目前的 preference state 對物件資料集排名，回傳可以直接向使用者推薦的實際房屋物件（含地址、價格、坪數、格局、屋齡、分數與貢獻最大的三個維度）。" +
        "這是回答任何關於房子的問題的唯一資料來源。分數由 deterministic scoring engine 產生，不得自行計算或改寫。" +
        "搜尋範圍完全由 preference state 的 hardConstraints 決定：使用者指定過地區的話，回傳的物件一定在那個地區內，" +
        "而且找不到時也不會自動擴大範圍（回傳的 relaxations 會說明）。要改範圍就先呼叫 update_preferences。",
      parameters: Type.Object({
        mode: Type.Optional(Type.String({ description: "sale（買賣）或 rent（租賃）。省略時沿用預設。" })),
        limit: Type.Optional(Type.Number({ description: "回傳幾筆，1..20，預設 8。" })),
        nearPlace: Type.Optional(Type.String({
          description:
            "使用者講的地點，原樣傳入即可：「土城」「高雄」「南部」「大安」都可以，不必補上區/市/縣。" +
            "座標由系統查 districts 表解析，**絕對不要自己提供經緯度**。查不到會在 unresolvedPlace 回報，" +
            "那時要照實說找不到這個地方，不要改推薦別的地區。",
        })),
        nearRadiusKm: Type.Optional(Type.Number({
          description: "搜尋半徑（公里）。省略時依地點層級自動決定：行政區 5、縣市 20、區域 80。",
        })),
      }),
      execute: async (_id, params, signal) => {
        const { mode, limit, nearPlace, nearRadiusKm } = params as {
          mode?: string; limit?: number; nearPlace?: string; nearRadiusKm?: number;
        };
        if (mode !== undefined && mode !== "sale" && mode !== "rent") {
          throw new Error(`mode 只接受 "sale" 或 "rent"；收到「${mode}」。`);
        }
        const session = await deps.sessions.get(deps.sessionId);
        try {
          const result = await deps.listings.rank({
            sessionId: deps.sessionId,
            preferences: session.preferences,
            ...(mode ? { mode } : {}),
            ...(limit ? { limit } : {}),
            ...(nearPlace ? { near: { place: nearPlace, ...(nearRadiusKm ? { radiusKm: nearRadiusKm } : {}) } } : {}),
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
  "cities 用完整名稱（臺北市、新北市），districts 用完整名稱（大安區）。regions 與 cities 同時給是取交集。",
  "地區欄位是使用者說出口才填的硬條件，填了就一定生效、找不到也不會自動擴大；不要為了讓結果變多而自己塞。",
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
