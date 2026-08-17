import type {
  FengshuiEvidence,
  FengshuiFeatureKey,
  FengshuiIssueKey,
  FengshuiRule,
} from '@/lib/types/fengshui'
import { FENGSHUI_ISSUE_KEYS } from '@/lib/types/fengshui'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * 取出規則所需的證據；任一為 null 就整條回 null。
 * 「未檢測」與「檢測後無虞」必須分得開 —— 前者不該進分母，也不該被說成「這間沒問題」。
 */
function readInputs(
  e: FengshuiEvidence,
  keys: readonly FengshuiFeatureKey[],
): number[] | null {
  const out: number[] = []
  for (const k of keys) {
    const v = e[k]
    if (v === null || v === undefined || Number.isNaN(v)) return null
    out.push(v)
  }
  return out
}

/**
 * 旗標欄位經 fillDataGaps 的中位數補值後會變成 0..1 的小數（不再只有 0/1），
 * 所以取用前一律 clamp01，讓所有 risk 公式對小數輸入仍然單調且落在 0..1。
 */
const flag = (v: number): number => clamp01(v)

/** 明堂縱深斜坡：3.6 公尺以上不算窄，2.4 公尺以下算滿分狹窄，中間線性內插 */
const HALL_DEPTH_OK_M = 3.6
const HALL_DEPTH_SPAN_M = 1.2

export const FENGSHUI_RULES: readonly FengshuiRule[] = [
  {
    key: 'throughDraft',
    name: '穿堂煞',
    detection: '格局圖辨識：大門正對客廳窗戶或後門。',
    taboo: '財來財去、難以聚財，氣場直來直往。',
    remedy: '設置玄關屏風、半高鞋櫃、展示櫃或長效不透光布簾。',
    severity: 0.25,
    inputs: ['fsEntryWindowAligned', 'fsEntryScreen'],
    risk: (e) => {
      const v = readInputs(e, ['fsEntryWindowAligned', 'fsEntryScreen'])
      if (!v) return null
      // 已有屏風即視為化解，所以是「對齊程度」被「屏風程度」等比折抵
      return clamp01(flag(v[0]) * (1 - flag(v[1])))
    },
  },
  {
    key: 'stoveInSight',
    name: '開門見灶',
    detection: '格局圖／照片：大門打開直接看見瓦斯爐。',
    taboo: '火氣外露、容易破財與脾氣暴躁。',
    remedy: '在爐灶與大門之間加裝拉門、屏風，或調整爐具位置。',
    severity: 0.15,
    inputs: ['fsStoveVisibleFromDoor'],
    risk: (e) => {
      const v = readInputs(e, ['fsStoveVisibleFromDoor'])
      return v ? flag(v[0]) : null
    },
  },
  {
    key: 'toiletFacingDoor',
    name: '開門見廁',
    detection: '格局圖／照片：大門打開直對馬桶或衛浴門。',
    taboo: '穢氣迎人、影響健康與運勢。',
    remedy: '衛浴門常閉、加裝隱藏門，或在門口掛風水簾並保持通風乾燥。',
    severity: 0.20,
    inputs: ['fsToiletFacingDoor'],
    risk: (e) => {
      const v = readInputs(e, ['fsToiletFacingDoor'])
      return v ? flag(v[0]) : null
    },
  },
  {
    key: 'beamPressure',
    name: '樑壓床／樑壓沙發',
    detection: '照片／高度數據：天花板大樑壓在床頭或沙發上方。',
    taboo: '壓迫感重、容易頭痛、精神壓力大、運勢受壓抑。',
    remedy: '透過木作天花板做圓弧形包覆修飾、避開壓頭處，或將床位平移。',
    severity: 0.15,
    inputs: ['fsBeamOverBed'],
    risk: (e) => {
      const v = readInputs(e, ['fsBeamOverBed'])
      return v ? flag(v[0]) : null
    },
  },
  {
    key: 'narrowHall',
    name: '明堂狹窄',
    detection: '格局圖：客廳採光面受阻或客廳縱深不足。',
    taboo: '發展受限、前途黯淡、眼光短淺。',
    remedy: '善用鏡面反射增加視覺空間、簡化家具配置、提升室內照明。',
    severity: 0.10,
    inputs: ['fsDaylightBlocked', 'fsLivingRoomDepthM'],
    risk: (e) => {
      const v = readInputs(e, ['fsDaylightBlocked', 'fsLivingRoomDepthM'])
      if (!v) return null
      // 遮蔽與縱深各自都足以構成「明堂狹窄」，取較嚴重者而非相加，避免雙重扣分
      const depth = clamp01((HALL_DEPTH_OK_M - v[1]) / HALL_DEPTH_SPAN_M)
      return clamp01(Math.max(flag(v[0]), depth))
    },
  },
  {
    key: 'roadRush',
    name: '路衝／壁刀',
    detection: 'Google 街景圖：正對 T 字路口或鄰棟牆角切進來。',
    taboo: '意外血光、車禍風險、氣場不穩。',
    remedy: '裝設隔音窗、窗戶貼防爆膜，或透過陽台植栽進行視覺緩衝。',
    severity: 0.15,
    inputs: ['fsRoadRush'],
    risk: (e) => {
      const v = readInputs(e, ['fsRoadRush'])
      return v ? flag(v[0]) : null
    },
  },
] as const

export const FENGSHUI_RULE_BY_KEY: Record<FengshuiIssueKey, FengshuiRule> =
  Object.fromEntries(FENGSHUI_RULES.map((r) => [r.key, r])) as Record<FengshuiIssueKey, FengshuiRule>

// 契約要求 FENGSHUI_RULES 與 FENGSHUI_ISSUE_KEYS 同序同集合，這裡在載入時就炸掉比在 UI 少一項好抓
if (
  FENGSHUI_RULES.length !== FENGSHUI_ISSUE_KEYS.length ||
  FENGSHUI_RULES.some((r, i) => r.key !== FENGSHUI_ISSUE_KEYS[i])
) {
  throw new Error('FENGSHUI_RULES 必須與 FENGSHUI_ISSUE_KEYS 同順序、同集合')
}
