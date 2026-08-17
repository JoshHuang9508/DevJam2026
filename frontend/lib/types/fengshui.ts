/**
 * 風水體檢的型別契約。
 *
 * 風水是文化偏好，不是科學結論 —— 這裡的「傳統忌諱」只描述民間說法，
 * 不主張任何財運、健康或運勢的因果；可執行的部分一律落在採光、動線、噪音與裝潢建議上。
 *
 * 分工同 lib/scoring 的既有不變量：LLM 只負責把「我在意風水」轉成權重變動，
 * 命中判定完全由 lib/fengshui 的確定性規則引擎處理，可單元測試、毫秒回應。
 */

export type FengshuiIssueKey =
  | 'throughDraft'      // 穿堂煞
  | 'stoveInSight'      // 開門見灶
  | 'toiletFacingDoor'  // 開門見廁
  | 'beamPressure'      // 樑壓床／樑壓沙發
  | 'narrowHall'        // 明堂狹窄
  | 'roadRush'          // 路衝／壁刀

export const FENGSHUI_ISSUE_KEYS: readonly FengshuiIssueKey[] = [
  'throughDraft', 'stoveInSight', 'toiletFacingDoor', 'beamPressure', 'narrowHall', 'roadRush',
] as const

/** 證據欄位：全部併入 listing_features，型別一律 number | null。
 *  旗標用 0/1（null = 未檢測），距離用公尺。真實 pipeline 由格局圖／照片／街景圖的視覺模型填。 */
export type FengshuiFeatureKey =
  | 'fsEntryWindowAligned'   // 大門與客廳窗／後門在同一直線
  | 'fsEntryScreen'          // 已有玄關屏風／半高鞋櫃（化解穿堂煞）
  | 'fsStoveVisibleFromDoor' // 大門開啟可直視瓦斯爐
  | 'fsToiletFacingDoor'     // 大門正對衛浴門／馬桶
  | 'fsBeamOverBed'          // 床頭或沙發上方有大樑
  | 'fsLivingRoomDepthM'     // 客廳縱深（公尺）
  | 'fsDaylightBlocked'      // 客廳主採光面受鄰棟遮蔽
  | 'fsRoadRush'             // 正對 T 字路口或鄰棟壁刀切入

export const FENGSHUI_FEATURE_KEYS: readonly FengshuiFeatureKey[] = [
  'fsEntryWindowAligned',
  'fsEntryScreen',
  'fsStoveVisibleFromDoor',
  'fsToiletFacingDoor',
  'fsBeamOverBed',
  'fsLivingRoomDepthM',
  'fsDaylightBlocked',
  'fsRoadRush',
] as const

export type FengshuiEvidence = { [K in FengshuiFeatureKey]: number | null }

export interface FengshuiRule {
  key: FengshuiIssueKey
  /** 風水項目 */
  name: string
  /** 檢測依據：真實 pipeline 由哪一種輸入判斷 */
  detection: string
  /** 傳統忌諱說明 */
  taboo: string
  /** 科學／裝潢解法建議 */
  remedy: string
  /** 0..1 嚴重度，決定扣分比重 */
  severity: number
  /** 需要的證據欄位；任一為 null 即視為未檢測 */
  inputs: readonly FengshuiFeatureKey[]
  /** 0..1 命中程度，1 = 完全命中；輸入不足回 null */
  risk: (e: FengshuiEvidence) => number | null
}
