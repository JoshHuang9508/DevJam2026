/**
 * 在候選池內做 min-max 正規化。
 * 全部相同或只有一筆時一律回 0.5 — 該維度無鑑別度，不應影響排序。
 */
export function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return []
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const span = max - min
  if (span === 0) return values.map(() => 0.5)
  return values.map((v) => (v - min) / span)
}
