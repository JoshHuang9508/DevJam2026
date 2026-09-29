import type { SearchProfile } from '@/lib/types/profile'

export function weightDiff(
  before: SearchProfile,
  after: SearchProfile,
): Partial<Record<keyof SearchProfile['weights'], { from: number; to: number }>> {
  const out: Partial<Record<keyof SearchProfile['weights'], { from: number; to: number }>> = {}
  for (const key of Object.keys(after.weights) as Array<keyof SearchProfile['weights']>) {
    const from = before.weights[key]
    const to = after.weights[key]
    if (from !== to) out[key] = { from, to }
  }
  return out
}
