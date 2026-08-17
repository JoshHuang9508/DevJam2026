import type { Candidate } from "../../domain/candidates/schema.js";
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
}

export interface RankListingsInput {
  /** 讓前端取回這個 session 的 client profile 當計分 base，agent 的名次才會跟畫面一致。 */
  sessionId: string;
  preferences: PreferenceState;
  districts?: Candidate[];
  mode?: "sale" | "rent";
  limit?: number;
  signal?: AbortSignal;
}

export interface ListingsProvider {
  rank(input: RankListingsInput): Promise<RankListingsResult>;
}

/** 前端沒起來或資料庫沒建時丟這個，讓 tool 回一句人看得懂的話而不是整輪爆掉。 */
export class ListingsUnavailableError extends Error {}

export function createListingsProvider(options: { baseUrl: string; timeoutMs: number }): ListingsProvider {
  const endpoint = `${options.baseUrl.replace(/\/$/, "")}/api/rank/preferences`;

  return {
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
            districts: input.districts ?? [],
            mode: input.mode,
            limit: input.limit,
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
