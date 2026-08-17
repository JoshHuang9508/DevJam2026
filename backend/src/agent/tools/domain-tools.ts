import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { preferencePatchSchema, type PreferencePatch } from "../../domain/preferences/schema.js";
import { urbanPlanCitySchema } from "../../domain/urban-plan/schema.js";
import { ListingsUnavailableError, type ListingsProvider } from "../../providers/listings/index.js";
import { TwinkleUnavailableError, type TwinkleClient } from "../../providers/twinkle/index.js";
import { WebSearchUnavailableError, type WebSearchProvider } from "../../providers/websearch/index.js";
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
  twinkle: TwinkleClient | null;
  webSearch: WebSearchProvider | null;
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
        mode: Type.Optional(Type.String({
          description: "sale（買賣）或 rent（租賃）。省略時沿用 preference state 裡的 mode。" +
            "要長期改變買/租意圖請用 update_preferences 寫 hardConstraints.mode，這個參數只影響單次查詢。",
        })),
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
            // 沒特別指定就用 state 裡的，state 也沒有才交給前端決定
            ...(mode ? { mode } : session.preferences.hardConstraints.mode ? { mode: session.preferences.hardConstraints.mode } : {}),
            ...(limit ? { limit } : {}),
            ...(nearPlace ? { near: { place: nearPlace, ...(nearRadiusKm ? { radiusKm: nearRadiusKm } : {}) } } : {}),
            ...(signal ? { signal } : {}),
          });
          // 前端要用同一份 profile 重算，才能保證畫面與 agent 講的是同一批物件。
          if (result.effectiveProfile) {
            deps.publish({
              type: "listings.ranked",
              effectiveProfile: result.effectiveProfile,
              total: result.total,
              ...eventMeta(deps.turnId),
            });
          }
          // effectiveProfile 對模型沒有意義，只會白白吃掉 context —— 不進 tool result。
          const { effectiveProfile: _omit, ...forModel } = result;
          // 0 筆是常見且有意義的結果（條件太嚴），不是錯誤 —— 讓 agent 拿著
          // relaxations 去說明為什麼，而不是丟例外把整輪打斷。
          return textResult(forModel);
        } catch (error) {
          if (error instanceof ListingsUnavailableError) {
            return textResult({ error: error.message, listings: [], total: 0, relaxations: [] });
          }
          throw error;
        }
      },
    },
    ...(deps.twinkle ? twinkleTools(deps.twinkle, textResult) : []),
    ...(deps.webSearch ? [{
      name: "web_search",
      label: "網頁搜尋",
      description:
        "搜尋網路。用在**結構化資料答不出來**的問題：某個建案或社區的評價、這一區最近的新聞、" +
        "重大建設或捷運延伸線進度、嫌惡設施爭議。物件的價格坪數屋齡機能一律用 rank_listings，不要用這個重查。" +
        "回傳的是網路上的說法，不是查證過的事實 —— 引用時要標明出處連結，並說明那是網路資訊。",
      parameters: Type.Object({
        query: Type.String({ description: "搜尋字串。加上地名與年份會準很多，例如「台北市大安區 2026 都市更新」。" }),
        maxResults: Type.Optional(Type.Number({ description: "回傳幾筆，1..8，預設 5。" })),
        recentDays: Type.Optional(Type.Number({ description: "只要最近 N 天的新聞。問「最近有沒有…」時設 30 或 90。" })),
      }),
      execute: async (_id: unknown, params: unknown, signal?: AbortSignal) => {
        const { query, maxResults, recentDays } = params as { query: string; maxResults?: number; recentDays?: number };
        try {
          return textResult(await deps.webSearch!.search({
            query,
            ...(maxResults ? { maxResults } : {}),
            ...(recentDays ? { recentDays } : {}),
            ...(signal ? { signal } : {}),
          }));
        } catch (error) {
          if (error instanceof WebSearchUnavailableError) {
            return textResult({ error: error.message, hint: "搜尋暫時不可用，照實告訴使用者，不要自己編造搜尋結果。" });
          }
          throw error;
        }
      },
    } as AgentTool<any>] : []),
  ];
}

/**
 * Twinkle Hub 提供的台灣公開資料工具。只挑跟「找房子」真的有關的幾個 ——
 * 它總共有 68 個 tool（專利、國考、藥品、教檢…），全部丟給模型只會稀釋
 * 注意力並吃掉 context，而且每次呼叫都要消耗額度。
 *
 * 沒有金鑰時整組不註冊，模型看不到就不會嘗試呼叫。
 */
function twinkleTools(
  twinkle: TwinkleClient,
  textResult: (data: unknown) => { content: Array<{ type: "text"; text: string }>; details: unknown },
): AgentTool<any>[] {
  const proxy = (
    name: string,
    label: string,
    description: string,
    parameters: ReturnType<typeof Type.Object>,
    remote: string,
    mapArgs: (params: Record<string, unknown>) => Record<string, unknown> = (p) => p,
  ): AgentTool<any> => ({
    name, label, description, parameters,
    execute: async (_id, params, signal) => {
      try {
        return textResult({ source: "Twinkle Hub（台灣政府開放資料）", result: await twinkle.call(remote, mapArgs(params as Record<string, unknown>), signal) });
      } catch (error) {
        // 外部服務失敗不該打斷整輪對話 —— 回一句話讓 agent 說「這項查不到」就好
        if (error instanceof TwinkleUnavailableError) {
          return textResult({ error: error.message, hint: "這項外部資料暫時取不到，請照實告訴使用者，不要自己編造。" });
        }
        throw error;
      }
    },
  });

  return [
    proxy(
      "tw_search_datasets", "搜尋台灣政府開放資料",
      "以關鍵字搜尋台灣政府開放資料平台的 5.3 萬個資料集，找出可以回答問題的 dataset_id。" +
      "使用者問到本系統沒有預先準備的在地資訊時用它 —— 例如學區、人口、治安、嫌惡設施、公共設施。" +
      "找到 dataset_id 後再用 tw_query_rows 取實際資料。",
      Type.Object({
        query: Type.String({ description: "關鍵字，例如「國小 位置」「刑案發生數」「人口密度」" }),
        limit: Type.Optional(Type.Number({ description: "回傳幾筆，預設 10" })),
      }),
      "tw_search_datasets",
    ),
    proxy(
      "tw_query_dataset_rows", "查詢資料集內容",
      "對某個資料集下 SQL 風格的條件取實際資料列。dataset_id 來自 tw_search_datasets。" +
      "欄位名含中文時要用雙引號包起來，例如 where: \"\"縣市\" = '臺北市'\"。",
      Type.Object({
        dataset_id: Type.String({ description: "從 tw_search_datasets 取得" }),
        where: Type.Optional(Type.String({ description: "SQL WHERE 條件（不含 WHERE 關鍵字）" })),
        columns: Type.Optional(Type.String({ description: "要取的欄位，逗號分隔" })),
        limit: Type.Optional(Type.Number({ description: "回傳幾列，預設 20" })),
      }),
      "tw_query_rows",
    ),
    proxy(
      "tw_disaster_alerts", "查詢即時災害告警",
      "查某個縣市當下的災害告警：淹水、豪雨、河川水位、土石流、地震、颱風、空品。" +
      "使用者問到「這裡會不會淹水」「最近有沒有災害」時用它。" +
      "注意這是**當下的即時告警**，不是歷史淹水紀錄，也不能當成該地段長期風險的證據 —— 回答時要講清楚這個區別。",
      Type.Object({
        countyId: Type.Optional(Type.String({ description: "5 碼縣市代碼，臺北市 63000、新北市 65000、臺中市 66000、高雄市 64000、臺南市 67000。省略則回全國。" })),
        limit: Type.Optional(Type.Number({ description: "回傳幾筆，預設 10" })),
      }),
      "tw_rt_ncdr_active_alerts",
      (p) => ({ ...(p.countyId ? { CountyId: p.countyId } : {}), limit: p.limit ?? 10 }),
    ),
    proxy(
      "tw_statute_search", "檢索台灣法規條文",
      "以關鍵字檢索中華民國法規全文。使用者問到租賃、買賣、稅、公設比、實價登錄相關的法律問題時用它。" +
      "回答時要引用實際條文，並提醒你不是律師、僅供參考。",
      Type.Object({
        query: Type.String({ description: "關鍵字，例如「租賃住宅 押金」「房屋稅 自住」" }),
        law_name: Type.Optional(Type.String({ description: "限定法規名稱，例如「土地法」" })),
        limit: Type.Optional(Type.Number({ description: "回傳幾筆，預設 5" })),
      }),
      "tw_statute_search_text",
    ),
  ];
}

/** Canonical PreferencePatch paths. hardConstraints is flat — it has no per-dimension nesting. */
const PATCH_SHAPE = [
  "hardConstraints: mode (sale 買賣 | rent 租賃), regions[] (北部|中部|南部|東部|離島), cities[], districts[], excludedCities[], excludedDistricts[],",
  "minMonthlyRent / maxMonthlyRent 是**租賃**的月租（元）；minTotalPriceWan / maxTotalPriceWan 是**買賣**的總價（萬元）。",
  "物件層級硬條件（會直接把不符合的物件濾掉，不是加減分）：minArea 坪、minRooms 房數、maxAge 屋齡年、",
  "buildingTypes[] 只接受 大樓|華廈|公寓|透天、needElevator、needParking、maxWalkMinutesToMetro 步行分鐘、maxCommuteMinutes 通勤分鐘。",
  "使用者說「預算兩千萬」要寫 maxTotalPriceWan: 2000，說「租金兩萬以內」要寫 maxMonthlyRent: 20000。兩者不可混用。",
  "minMonthlyRent, maxMonthlyRent, maxCommuteMinutes — all flat, never nested under housing/transportation.",
  "cities 用完整名稱（臺北市、新北市），districts 用完整名稱（大安區）。regions 與 cities 同時給是取交集。",
  "地區欄位是使用者說出口才填的硬條件，填了就一定生效、找不到也不會自動擴大；不要為了讓結果變多而自己塞。",
  "softPreferences.housing: weight, preferLowerRent.",
  "softPreferences.climate: weight, temperature{preferredMin,preferredMax,weight}, rainfall{preference:low|medium|high,weight}, humidity{preference,weight}.",
  "softPreferences.transportation: weight, railwayAccess, highSpeedRailAccess, mrtAccess, busAccess.",
  "softPreferences.amenities: weight, convenienceStore, supermarket, hospital, clinic, restaurant, school, park.",
  "softPreferences.geography: weight, urbanDensity, elevation, coastalPreference (-1..1).",
  "listingPreferences: fengshuiWeight (0..1), hazardWeight (0..1), avoidFengshui[] — 物件層級，不影響行政區排名，前端拿去排物件。",
  "hazardWeight 是災害風險（附近淹水災點密度 + 土壤液化潛勢）的比重，預設 0.5。使用者說「怕淹水」「不要低窪」「在意土壤液化」就調高它。",
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
