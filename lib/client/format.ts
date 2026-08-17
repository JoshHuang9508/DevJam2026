import type { Mode } from '@/lib/types/profile'

const withThousands = (n: number): string => n.toLocaleString('zh-Hant-TW')

/** 買賣：萬元總價（破億改用億）；租賃：元/月 */
export function formatPrice(l: { mode: Mode; price: number }): string {
  if (l.mode === 'rent') return `${withThousands(Math.round(l.price))} 元/月`
  if (l.price >= 10_000) return `${(l.price / 10_000).toFixed(1)} 億`
  return `${withThousands(Math.round(l.price))} 萬`
}

export function formatArea(ping: number): string {
  return `${ping.toFixed(1)} 坪`
}

export function formatDistance(meters: number | null): string {
  if (meters === null) return '—'
  if (meters < 1000) return `${Math.round(meters)} 公尺`
  return `${(meters / 1000).toFixed(1)} 公里`
}

export function formatCommute(minutes: number | null): string {
  if (minutes === null) return '—'
  return `約 ${Math.round(minutes)} 分鐘`
}
