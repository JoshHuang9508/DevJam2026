import { auditFengshui } from '@/lib/fengshui/audit'
import { FENGSHUI_RULE_BY_KEY } from '@/lib/fengshui/rules'
import type { FengshuiEvidence, FengshuiIssueKey } from '@/lib/types/fengshui'
import type { ScoredListing } from '@/lib/types/listing'
import type { SearchProfile } from '@/lib/types/profile'
import { getGenAI, getModel } from './client'
import { EXPLAIN_SYSTEM_PROMPT } from './prompts'

/** 只帶前 5 筆進 prompt，其餘卡片使用者自己看得到 */
const EXPLAIN_TOP_N = 5

const names = (keys: readonly FengshuiIssueKey[]): string =>
  keys.map((k) => FENGSHUI_RULE_BY_KEY[k].name).join('、')

/**
 * 一行風水摘要。命中與未檢測都要寫出來 ——
 * 只講命中會讓模型把「沒判讀到」說成「這間沒問題」，那是憑空保證。
 * 六項全部無虞時只講無虞，不必列出六個名字灌長 prompt。
 */
function fengshuiLine(e: FengshuiEvidence): string {
  const audit = auditFengshui(e)
  const parts: string[] = []
  if (audit.issues.length > 0) parts.push(`命中 ${names(audit.issues.map((i) => i.key))}`)
  else if (audit.clear.length > 0) parts.push('已檢測項目均無虞')
  if (audit.unknown.length > 0) parts.push(`未檢測 ${names(audit.unknown)}`)
  return `   風水：${parts.join('；') || '未檢測'}`
}

export function buildExplainPrompt(
  profile: SearchProfile,
  results: ScoredListing[],
  relaxations: string[],
): string {
  const sections: string[] = [
    `［使用者目前的權重］\n${JSON.stringify(profile.weights)}`,
    `［硬性條件］\n${JSON.stringify(profile.hard)}`,
    `［軟性偏好］\n${JSON.stringify(profile.soft)}`,
  ]

  if (profile.notes.length > 0) {
    sections.push(`［使用者說過的話］\n${profile.notes.join('\n')}`)
  }

  if (results.length === 0) {
    sections.push('［排序結果］\n沒有找到任何符合的物件。請說明可能的原因，並具體建議使用者可以放寬哪一項條件。')
  } else {
    const top = results.slice(0, EXPLAIN_TOP_N).map((r, i) => {
      const f = r.features
      return [
        `${i + 1}. ${r.city}${r.district}｜${r.title}`,
        `   價格 ${r.price}（${r.mode === 'sale' ? '萬元總價' : '元每月'}）｜${r.area} 坪｜${r.layout}｜屋齡 ${r.age} 年｜${r.floor}/${r.totalFloor} 樓｜${r.buildingType}`,
        `   離捷運 ${f.distToMetro ?? '不明'} 公尺｜估計通勤 ${f.commuteToCbdMin ?? '不明'} 分鐘`,
        `   夏均溫 ${f.summerTemp ?? '不明'}°C｜年雨日 ${f.rainDays ?? '不明'} 天｜AQI ${f.aqiMean ?? '不明'}`,
        `   500 公尺內：超商 ${f.poiConvenience500 ?? '不明'}、超市 ${f.poiSupermarket500 ?? '不明'}、公園 ${f.poiPark500 ?? '不明'}`,
        fengshuiLine(f),
        `   各維度貢獻 ${JSON.stringify(
          Object.fromEntries(Object.entries(r.breakdown).map(([k, v]) => [k, Number(v.contribution.toFixed(3))])),
        )}`,
        r.dataGaps.length > 0 ? `   資料不足的欄位：${r.dataGaps.join('、')}` : '',
      ].filter(Boolean).join('\n')
    })
    sections.push(`［排序結果前 ${top.length} 筆］\n${top.join('\n')}`)
  }

  if (relaxations.length > 0) {
    sections.push(`［已放寬的條件，必須在回覆中明講］\n${relaxations.join('\n')}`)
  }

  return sections.join('\n\n')
}

/** 串流解釋文字。呼叫端負責處理錯誤（見 /api/chat 的降級路徑）。 */
export async function* streamExplanation(prompt: string): AsyncGenerator<string> {
  const stream = await getGenAI().models.generateContentStream({
    model: getModel(),
    contents: prompt,
    config: {
      systemInstruction: EXPLAIN_SYSTEM_PROMPT,
      temperature: 0.6,
    },
  })
  for await (const chunk of stream) {
    const text = chunk.text
    if (text) yield text
  }
}
