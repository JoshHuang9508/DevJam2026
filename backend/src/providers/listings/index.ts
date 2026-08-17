import type { PreferenceState } from "../../domain/preferences/schema.js";

/**
 * 物件層級的資料來源。實際的 SQLite（前端的 data/app.db）與計分邏輯都在前端，
 * 這裡只是把後端 agent 的 PreferenceState 送過去換回排好的物件。
 *
 * 為什麼不在後端自己讀 SQLite 再算一次分數：那會變成兩份排序器。使用者畫面上看到
 * 的卡片由前端 lib/scoring 排，agent 嘴巴講的若由後端另一份程式排，兩者只要有一個
 * 欄位處理不同就會開始漂移 —— 畫面第一名是 A，agent 卻在誇 B，而且沒有任何測試會抓到。
 * 所以排序器只留一份，後端透過 HTTP 借用它。
 */

export interface RankedListing {
  id: string;
  title: string;
  url: string;
  city: string;
  district: string;
  address: string;
  price: number;
  unitPrice: number;
  area: number;
  layout: string;
  floor: number;
  totalFloor: number;
  age: number;
  buildingType: string;
  hasElevator: boolean;
  hasParking: boolean;
  score: number;
  topDimensions: { dimension: string; subscore: number; weight: number }[];
  distToMetro: number | null;
  commuteToCbdMin: number | null;
  pricePercentile: number | null;
  dataGaps: string[];
}

export interface RankListingsResult {
  mode: "sale" | "rent";
  total: number;
  relaxations: string[];
  listings: RankedListing[];
  /** 地名被解析成什麼（含實際採用的半徑）。null 代表沒指定地點。 */
  resolvedPlace?: { lat: number; lng: number; radiusKm: number; label: string } | null;
  /** 有指定地點但查不到時，原樣回傳讓 agent 照實說找不到。 */
  unresolvedPlace?: string;
  /**
   * 這一輪實際拿去計分的 SearchProfile（前端格式）。轉發給前端讓它用同一份重算，
   * 兩邊的排名才會逐筆一致。內容對 LLM 沒有意義，所以不會進 tool result。
   */
  effectiveProfile?: unknown;
}

export interface RankListingsInput {
  /** 讓前端取回這個 session 的 client profile 當計分 base，agent 的名次才會跟畫面一致。 */
  sessionId: string;
  preferences: PreferenceState;
  mode?: "sale" | "rent";
  limit?: number;
  /** 模糊地點。只給地名，座標由前端查 districts 表解析 —— 模型不得自己生經緯度。 */
  near?: { place: string; radiusKm?: number };
  signal?: AbortSignal;
}

/** 資料集實際涵蓋的縣市／行政區與筆數。agent 用來判斷「查不到」是條件太嚴還是根本沒資料。 */
export interface DatasetSummary {
  mode: "sale" | "rent";
  total: number;
  cities: string[];
  districts: { city: string; district: string; count: number; medianPrice: number; medianArea: number }[];
  priceUnit: string;
  source: string;
}

export interface ListingsProvider {
  rank(input: RankListingsInput): Promise<RankListingsResult>;
  describe(mode: "sale" | "rent", signal?: AbortSignal): Promise<DatasetSummary>;
}

/** 前端沒起來或資料庫沒建時丟這個，讓 tool 回一句人看得懂的話而不是整輪爆掉。 */
export class ListingsUnavailableError extends Error {}

export function createListingsProvider(options: { baseUrl: string; timeoutMs: number }): ListingsProvider {
  const base = options.baseUrl.replace(/\/$/, "");
  const endpoint = `${base}/api/rank/preferences`;

  return {
    async describe(mode, callerSignal) {
      const timeout = AbortSignal.timeout(options.timeoutMs);
      const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
      let response: Response;
      try {
        response = await fetch(`${base}/api/rank/dataset?mode=${mode}`, { signal });
      } catch (error) {
        throw new ListingsUnavailableError(`物件資料服務連線失敗：${error instanceof Error ? error.message : String(error)}`);
      }
      if (!response.ok) {
        throw new ListingsUnavailableError(`物件資料服務回應 ${response.status}`);
      }
      return (await response.json()) as DatasetSummary;
    },

    async rank(input) {
      // 呼叫端的 signal 與逾時要一起生效：只用其中一個的話，使用者中斷了連線
      // 這個 fetch 還會繼續跑滿 timeout，或是前端掛掉時整輪 agent 卡在這裡。
      const timeout = AbortSignal.timeout(options.timeoutMs);
      const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: input.sessionId,
            preferences: input.preferences,
            mode: input.mode,
            limit: input.limit,
            near: input.near,
          }),
          signal,
        });
      } catch (error) {
        throw new ListingsUnavailableError(`物件資料服務連線失敗：${error instanceof Error ? error.message : String(error)}`);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ListingsUnavailableError(`物件資料服務回應 ${response.status}${body ? `：${body.slice(0, 200)}` : ""}`);
      }
      return (await response.json()) as RankListingsResult;
    },
  };
}
