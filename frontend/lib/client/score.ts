/**
 * Single source of truth for how a ranking position becomes a colour.
 *
 * 依「名次」而非「分數」上色：分數是加權平均，同一批結果常擠在很窄的區間
 * （例如 0.74~0.82），照分數線性對映會讓所有圖示看起來同一個顏色。
 * 用名次百分位可保證第一名一定是綠、最後一名一定是紅，色帶永遠鋪滿。
 */
interface RampStop {
  readonly at: number
  readonly color: readonly [number, number, number]
}

export const RANK_STOPS: readonly RampStop[] = [
  { at: 0, color: [22, 163, 74] },    // green-600 — 排名靠前
  { at: 0.5, color: [234, 179, 8] },  // yellow-500
  { at: 1, color: [220, 38, 38] },    // red-600 — 排名靠後
]

function sampleRamp(stops: readonly RampStop[], position: number): string {
  const p = Math.min(1, Math.max(0, position))
  let lo = stops[0]
  let hi = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (p >= stops[i].at && p <= stops[i + 1].at) {
      lo = stops[i]
      hi = stops[i + 1]
      break
    }
  }
  const span = hi.at - lo.at
  const t = span === 0 ? 0 : (p - lo.at) / span
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  return `rgb(${mix(lo.color[0], hi.color[0])}, ${mix(lo.color[1], hi.color[1])}, ${mix(lo.color[2], hi.color[2])})`
}

/**
 * 綠 → 黃 → 紅漸層。`index` 為 0-based 名次，`total` 為該批結果筆數。
 * total <= 1 時整批只有第一名，直接回綠色（除以 0 會變 NaN）。
 */
export function rankColor(index: number, total: number): string {
  return sampleRamp(RANK_STOPS, total <= 1 ? 0 : index / (total - 1))
}

/** Scores are a weighted mean of 0..1 subscores; show them as 0..100. */
export function scorePercent(score: number): number {
  return Math.round(score * 100)
}
