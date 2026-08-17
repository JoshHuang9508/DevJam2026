/**
 * Single source of truth for how a 0..1 score becomes a colour.
 * The map paints markers with these stops and the cards use the same ramp, so a
 * marker and its card always read as the same "temperature".
 */
interface ScoreStop {
  readonly at: number
  readonly color: readonly [number, number, number]
}

export const SCORE_STOPS: readonly ScoreStop[] = [
  { at: 0, color: [148, 163, 184] },  // slate-400
  { at: 0.5, color: [245, 158, 11] }, // amber-500
  { at: 0.8, color: [220, 38, 38] },  // red-600
]

/** MapLibre `interpolate` stop list, flattened. */
export const SCORE_STOPS_FLAT: Array<number | string> = SCORE_STOPS.flatMap((s) => [
  s.at,
  `rgb(${s.color[0]}, ${s.color[1]}, ${s.color[2]})`,
])

export function scoreColor(score: number): string {
  const s = Math.min(1, Math.max(0, score))
  let lo = SCORE_STOPS[0]
  let hi = SCORE_STOPS[SCORE_STOPS.length - 1]
  for (let i = 0; i < SCORE_STOPS.length - 1; i++) {
    if (s >= SCORE_STOPS[i].at && s <= SCORE_STOPS[i + 1].at) {
      lo = SCORE_STOPS[i]
      hi = SCORE_STOPS[i + 1]
      break
    }
  }
  const span = hi.at - lo.at
  const t = span === 0 ? 0 : (s - lo.at) / span
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  return `rgb(${mix(lo.color[0], hi.color[0])}, ${mix(lo.color[1], hi.color[1])}, ${mix(lo.color[2], hi.color[2])})`
}

/** Scores are a weighted mean of 0..1 subscores; show them as 0..100. */
export function scorePercent(score: number): number {
  return Math.round(score * 100)
}
