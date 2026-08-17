/** 地圖視角。西南／東北兩角，與 Google Maps 的 LatLngBounds 對應。 */
export interface MapBounds {
  south: number
  west: number
  north: number
  east: number
}

/**
 * 視角判斷刻意放在 client：它只決定「這個圖釘要不要畫」，不參與排序也不進 API。
 * 放在 lib/scoring 會讓地圖元件為了一個純幾何比較把整個計分引擎拉進 client bundle。
 */
export function inBounds(p: { lat: number; lng: number }, b: MapBounds): boolean {
  if (p.lat < b.south || p.lat > b.north) return false
  // 跨換日線時 west > east，要拆成兩段判斷。台灣用不到，但地圖可以被拖到那裡。
  return b.west <= b.east
    ? p.lng >= b.west && p.lng <= b.east
    : p.lng >= b.west || p.lng <= b.east
}
