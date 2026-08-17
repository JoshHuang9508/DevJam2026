import type { FengshuiEvidence, FengshuiIssueKey } from '@/lib/types/fengshui'
import { FENGSHUI_RULES, FENGSHUI_RULE_BY_KEY } from './rules'

/** risk 達到這個門檻才算「命中」，低於此值視為無虞 */
export const FENGSHUI_HIT = 0.5

export interface FengshuiFinding { key: FengshuiIssueKey; risk: number }

export interface FengshuiAudit {
  /** 1 - Σ(severity*risk)/Σ(severity)，只計有檢測的規則；全部未檢測時為 null */
  score: number | null
  /** risk >= FENGSHUI_HIT 的項目，依 severity*risk 由大到小排 */
  issues: FengshuiFinding[]
  /** 有檢測且 risk < FENGSHUI_HIT */
  clear: FengshuiIssueKey[]
  /** 輸入不足，無法判斷 */
  unknown: FengshuiIssueKey[]
}

/** 未檢測的規則在排序分數裡採用的中性風險：既不獎勵也不懲罰缺資料的物件 */
export const FENGSHUI_UNKNOWN_RISK = 0.5

/** 單條規則的命中程度；輸入不足回 null（不是 0 —— 未檢測不等於沒問題） */
export function ruleRisk(key: FengshuiIssueKey, e: FengshuiEvidence): number | null {
  return FENGSHUI_RULE_BY_KEY[key].risk(e)
}

/**
 * 排序用的風水分數（0..1，恆為數字）。未檢測的規則以 FENGSHUI_UNKNOWN_RISK 計入。
 *
 * 這一維刻意讀**未補值**的原始證據，不走 fillDataGaps：
 * 0/1 旗標的同區中位數在基準率低於一半時恆為 0，補值等於把「沒有格局圖可判」
 * 直接寫成「這一項沒問題」—— 連續型欄位（氣溫、POI 數）用中位數是合理估計，
 * 旗標不是。照補值走的話，資料越少的物件風水分越高，最後排在最前面的會是
 * 沒人看得到格局的那些。示範資料只有 5% 缺圖所以影響小，真實格局圖辨識的
 * 覆蓋率遠低於此，那時這個偏差會直接主導名次。
 *
 * 與 auditFengshui().score 的分工：那個是「已檢測項目的表現」，給單一物件的卡片看；
 * 這個是「拿來跟其他物件比的分數」，未檢測要落在中間才公平。
 */
export function fengshuiSubscore(e: FengshuiEvidence): number {
  let penalty = 0
  let denom = 0
  for (const rule of FENGSHUI_RULES) {
    denom += rule.severity
    penalty += rule.severity * (rule.risk(e) ?? FENGSHUI_UNKNOWN_RISK)
  }
  return denom === 0 ? FENGSHUI_UNKNOWN_RISK : 1 - penalty / denom
}

/**
 * 風水體檢：把六條規則各自的 risk 聚合成 0..1 的分數與三類清單。
 *
 * 未檢測的規則同時從分子與分母剔除 —— 否則「沒資料」會被當成「沒問題」而虛胖分數，
 * 也不該反過來當成滿分風險把物件打死；不確定就明講在 unknown 裡讓 UI 標示。
 */
export function auditFengshui(e: FengshuiEvidence): FengshuiAudit {
  const issues: Array<FengshuiFinding & { weighted: number }> = []
  const clear: FengshuiIssueKey[] = []
  const unknown: FengshuiIssueKey[] = []

  let penalty = 0
  let denom = 0

  for (const rule of FENGSHUI_RULES) {
    const risk = rule.risk(e)
    if (risk === null) {
      unknown.push(rule.key)
      continue
    }
    denom += rule.severity
    const weighted = rule.severity * risk
    penalty += weighted
    if (risk >= FENGSHUI_HIT) issues.push({ key: rule.key, risk, weighted })
    else clear.push(rule.key)
  }

  // 同分時保持規則原順序（Array#sort 穩定），輸出才可重現、快照測試才不會抖
  issues.sort((a, b) => b.weighted - a.weighted)

  return {
    score: denom === 0 ? null : 1 - penalty / denom,
    issues: issues.map(({ key, risk }) => ({ key, risk })),
    clear,
    unknown,
  }
}
