const EARTH_RADIUS_M = 6_371_000

const toRad = (deg: number): number => (deg * Math.PI) / 180

export function haversineMeters(
  aLat: number, aLng: number, bLat: number, bLng: number,
): number {
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 鄰近軌道站的平均通勤速度 (km/h) */
const SPEED_NEAR_RAIL_KMH = 22
/** 不鄰近軌道站（公車／步行為主）的平均速度 (km/h) */
const SPEED_OFF_RAIL_KMH = 14
/** 進出站、等車、轉乘的固定耗時 (分鐘) */
const TRANSFER_PENALTY_NEAR_RAIL_MIN = 8
const TRANSFER_PENALTY_OFF_RAIL_MIN = 12

/**
 * 估計通勤時間。刻意不做真實路徑規劃 —
 * 直線距離 / 平均速度 + 固定轉乘懲罰，僅供相對排序，UI 須標示為「估計」。
 */
export function estimateCommuteMinutes(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
  nearRail: boolean,
): number {
  const km = haversineMeters(fromLat, fromLng, toLat, toLng) / 1000
  const speed = nearRail ? SPEED_NEAR_RAIL_KMH : SPEED_OFF_RAIL_KMH
  const penalty = nearRail ? TRANSFER_PENALTY_NEAR_RAIL_MIN : TRANSFER_PENALTY_OFF_RAIL_MIN
  return (km / speed) * 60 + penalty
}
