import { auditFengshui } from '@/lib/fengshui/audit'
import { FENGSHUI_RULE_BY_KEY } from '@/lib/fengshui/rules'
import type { FengshuiIssueKey } from '@/lib/types/fengshui'
import type { ScoredListing } from '@/lib/types/listing'

/**
 * 卡片內的風水體檢區塊。
 *
 * 判定完全交給 lib/fengshui 的確定性規則引擎，這裡只負責把 audit 的三類清單畫出來 ——
 * 元件不做任何門檻判斷或加權，避免畫面與排序引擎對「命中」的定義走鐘。
 *
 * 版面前提：卡片只有 18.5rem 寬，所以摘要壓成一行、細節收進 <details>，
 * 展開後才吃高度；<details> 是原生元素，不需要 state，因此本檔不必是 'use client'。
 */

/** 分數配色：沿用專案既有的 emerald／amber／red 語彙，不引入新色票 */
function scoreTone(score: number): string {
  if (score >= 0.85) return 'text-emerald-700'
  if (score >= 0.6) return 'text-amber-700'
  return 'text-red-700'
}

export function FengshuiCard({ listing }: { listing: ScoredListing }) {
  const audit = auditFengshui(listing.features)

  // score 為 null 代表六條規則的證據全缺。這時不能顯示 0 分 ——
  // 「未檢測」與「檢測後有問題」是完全不同的兩件事，混在一起會誤導。
  if (audit.score === null) {
    return (
      <div
        data-testid="fengshui-card"
        className="mt-2 rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5"
      >
        <p className="text-[11px] leading-none text-neutral-500">風水未檢測</p>
        {/* 這條分支若只寫「缺少證據」，反而是在宣稱系統真的有格局圖辨識管線、只是這間缺圖。
            模擬聲明必須跟著出現，否則誠實標示只守得住展開後的那一半。 */}
        <p className="mt-1 text-[10px] leading-relaxed text-neutral-400">
          此物件缺少格局圖／照片證據，無法判斷。示範資料的格局證據為模擬值，
          系統並未真的辨識格局圖。
        </p>
      </div>
    )
  }

  const score = Math.round(audit.score * 100)

  return (
    <details
      data-testid="fengshui-card"
      className="group mt-2 rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5"
    >
      {/* list-none + webkit 前綴：兩種引擎的預設三角形都要拿掉，才能用自己的 ▸ 對齊右側 */}
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] leading-none [&::-webkit-details-marker]:hidden">
        <span className="text-neutral-500">風水體檢</span>
        <span className={`font-semibold tabular-nums ${scoreTone(audit.score)}`}>{score}</span>
        <span className="truncate text-neutral-500">
          {audit.issues.length > 0 ? `命中 ${audit.issues.length} 項` : '無明顯忌諱'}
          {audit.unknown.length > 0 && `・${audit.unknown.length} 項未檢測`}
        </span>
        <span aria-hidden className="ml-auto shrink-0 text-neutral-400 transition group-open:rotate-90">
          ▸
        </span>
      </summary>

      <div className="mt-1.5 space-y-1.5 border-t border-neutral-200 pt-1.5">
        {audit.issues.map(({ key }) => (
          <Issue key={key} issueKey={key} />
        ))}

        {audit.clear.length > 0 && (
          <p className="text-[10px] leading-relaxed text-emerald-700">
            通過：{audit.clear.map((k) => FENGSHUI_RULE_BY_KEY[k].name).join('、')}
          </p>
        )}

        {/* 上面那個分數只計已檢測的項目，所以「100」不等於「整間都沒問題」。
            不講清楚的話，缺格局圖的物件看起來會像滿分優等生。 */}
        {audit.unknown.length > 0 && (
          <p className="text-[10px] leading-relaxed text-neutral-400">
            未檢測：{audit.unknown.map((k) => FENGSHUI_RULE_BY_KEY[k].name).join('、')}
            <br />
            上方分數只計已檢測項目；排序時未檢測項會以中性值計入，不因缺資料加分。
          </p>
        )}

        <p className="text-[10px] leading-relaxed text-neutral-400">
          風水為文化偏好而非科學結論，上述解法皆為裝潢與採光建議；
          示範資料的格局證據為模擬值，並未真的辨識格局圖。
        </p>
      </div>
    </details>
  )
}

function Issue({ issueKey }: { issueKey: FengshuiIssueKey }) {
  const rule = FENGSHUI_RULE_BY_KEY[issueKey]
  return (
    <div className="rounded bg-white px-1.5 py-1">
      <p className="text-[11px] font-medium leading-none text-amber-700">{rule.name}</p>
      {/* 忌諱明確標成「傳統說法」，與下一行的裝潢解法分開，不讓民間說法讀起來像結論 */}
      <p className="mt-1 text-[10px] leading-relaxed text-neutral-500">傳統說法：{rule.taboo}</p>
      <p className="mt-0.5 text-[10px] leading-relaxed text-neutral-600">解法：{rule.remedy}</p>
    </div>
  )
}
