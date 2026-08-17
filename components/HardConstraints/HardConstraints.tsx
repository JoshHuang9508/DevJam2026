'use client'

import { FENGSHUI_RULE_BY_KEY } from '@/lib/fengshui/rules'
import type { FengshuiIssueKey } from '@/lib/types/fengshui'
import type { HardConstraints as HardConstraintsType, Mode } from '@/lib/types/profile'

interface Props {
  hard: HardConstraintsType
  mode: Mode
  onChange: (next: HardConstraintsType) => void
}

interface Chip {
  chipKey: string
  key: keyof HardConstraintsType
  /** 陣列型欄位（cities / districts / buildingTypes / avoidFengshui）移除時要清掉的那一個值 */
  arrayValue?: string
  label: string
}

/**
 * 依 key 產生要顯示的 chip。逐一列舉 switch 是因為每個欄位需要不同的中文措辭與單位，
 * 但外層 iterate 的是 profile.hard 實際存在的 key（見下方 buildChips），
 * 不是寫死的欄位清單 —— 避免這裡與 lib/types/profile.ts 的 HardConstraints 走鐘。
 */
function chipsForKey(key: keyof HardConstraintsType, hard: HardConstraintsType, mode: Mode): Chip[] {
  const priceUnit = mode === 'sale' ? '萬' : '元/月'
  switch (key) {
    case 'cities':
      return (hard.cities ?? []).map((c) => ({ chipKey: `cities:${c}`, key, arrayValue: c, label: c }))
    case 'districts':
      return (hard.districts ?? []).map((d) => ({ chipKey: `districts:${d}`, key, arrayValue: d, label: d }))
    case 'buildingTypes':
      return (hard.buildingTypes ?? []).map((t) => ({ chipKey: `buildingTypes:${t}`, key, arrayValue: t, label: t }))
    case 'budgetMin':
      return hard.budgetMin === undefined
        ? []
        : [{ chipKey: 'budgetMin', key, label: `總價 ≥ ${hard.budgetMin} ${priceUnit}` }]
    case 'budgetMax':
      return hard.budgetMax === undefined
        ? []
        : [{ chipKey: 'budgetMax', key, label: `總價 ≤ ${hard.budgetMax} ${priceUnit}` }]
    case 'minArea':
      return hard.minArea === undefined ? [] : [{ chipKey: 'minArea', key, label: `坪數 ≥ ${hard.minArea} 坪` }]
    case 'minRooms':
      return hard.minRooms === undefined ? [] : [{ chipKey: 'minRooms', key, label: `房數 ≥ ${hard.minRooms} 房` }]
    case 'maxAge':
      return hard.maxAge === undefined ? [] : [{ chipKey: 'maxAge', key, label: `屋齡 ≤ ${hard.maxAge} 年` }]
    case 'needElevator':
      return hard.needElevator ? [{ chipKey: 'needElevator', key, label: '需要電梯' }] : []
    case 'needParking':
      return hard.needParking ? [{ chipKey: 'needParking', key, label: '需要車位' }] : []
    case 'maxDistToMetro':
      return hard.maxDistToMetro === undefined
        ? []
        : [{ chipKey: 'maxDistToMetro', key, label: `距捷運 ≤ ${hard.maxDistToMetro} 公尺` }]
    case 'avoidFengshui':
      // 一個忌諱一顆 chip，才能只拿掉「開門見廁」而保留「穿堂煞」。
      // 存的是 FengshuiIssueKey，顯示一律經 FENGSHUI_RULE_BY_KEY 轉成中文名 ——
      // 畫面上不該出現 throughDraft 這種內部代號。
      return (hard.avoidFengshui ?? []).map((issue) => ({
        chipKey: `avoidFengshui:${issue}`,
        key,
        arrayValue: issue,
        label: `避開${FENGSHUI_RULE_BY_KEY[issue].name}`,
      }))
    default:
      return []
  }
}

function buildChips(hard: HardConstraintsType, mode: Mode): Chip[] {
  const keys = Object.keys(hard) as (keyof HardConstraintsType)[]
  return keys.flatMap((key) => chipsForKey(key, hard, mode))
}

function isArrayKey(
  key: keyof HardConstraintsType,
): key is 'cities' | 'districts' | 'buildingTypes' | 'avoidFengshui' {
  return key === 'cities' || key === 'districts' || key === 'buildingTypes' || key === 'avoidFengshui'
}

function removeConstraint(hard: HardConstraintsType, chip: Chip): HardConstraintsType {
  const next: HardConstraintsType = { ...hard }
  const key = chip.key
  if (!isArrayKey(key) || chip.arrayValue === undefined) {
    delete next[key]
    return next
  }
  // avoidFengshui 的元素是 FengshuiIssueKey 而非 string，四個陣列欄位的聯集無法共用
  // 同一次 filter 呼叫，所以先攤成 string[] 比對，再依欄位各自寫回原本的元素型別。
  const remaining = ((hard[key] ?? []) as string[]).filter((v) => v !== chip.arrayValue)
  if (remaining.length === 0) delete next[key]
  else if (key === 'avoidFengshui') next.avoidFengshui = remaining as FengshuiIssueKey[]
  else next[key] = remaining
  return next
}

/** 顯示目前生效的硬性條件，讓使用者看得到、拿得掉 —— 否則一個對不上的城市會讓結果永遠是 0 筆且無法自救。 */
export function HardConstraints({ hard, mode, onChange }: Props) {
  const chips = buildChips(hard, mode)
  if (chips.length === 0) return null

  return (
    <div
      data-testid="hard-constraints"
      className="flex flex-wrap gap-1.5 border-b border-neutral-200 bg-neutral-50 px-4 py-2"
    >
      {chips.map((chip) => (
        <button
          key={chip.chipKey}
          type="button"
          onClick={() => onChange(removeConstraint(hard, chip))}
          className="inline-flex items-center gap-1 rounded-full border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:border-red-300 hover:text-red-700"
        >
          <span>{chip.label}</span>
          <span aria-hidden>✕</span>
        </button>
      ))}
    </div>
  )
}
