/// <reference types="google.maps" />

export interface CameraTarget {
  center: google.maps.LatLngLiteral
  zoom: number
}

/** easeInOutCubic：起步與收尾都慢，中段快，是相機移動最不暈的曲線 */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

export const CAMERA_DURATION_MS = 600

/**
 * 平滑移動相機。Maps JS 沒有「動畫版 setCenter+setZoom」：panTo 只在小距離內補間、
 * 且完全不管 zoom，setZoom 一律瞬移，所以切換物件時會看到「跳一下再跳一下」。
 * 官方對 vector map 的建議做法就是自己在 requestAnimationFrame 裡呼叫 moveCamera，
 * 這裡把 center 與 zoom 一起插值，兩者同時到位。
 *
 * zoom 要能連續插值，地圖必須是 vector 且開啟 fractional zoom（見 MapView 的 renderingType）；
 * raster 地圖會把中間的小數 zoom 夾成整數，中心點仍是平滑的。
 *
 * 回傳取消函式：新的目標進來、或使用者自己拖曳／滾輪時要呼叫，否則兩個動畫會互相搶相機。
 */
export function animateCamera(
  map: google.maps.Map,
  target: CameraTarget,
  durationMs = CAMERA_DURATION_MS,
): () => void {
  const startCenter = map.getCenter()
  const startZoom = map.getZoom()
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!startCenter || startZoom === undefined || durationMs <= 0 || reduced) {
    map.moveCamera({ center: target.center, zoom: target.zoom })
    return () => {}
  }

  const from = { lat: startCenter.lat(), lng: startCenter.lng(), zoom: startZoom }
  // 經度取最短路徑，免得從 179° 到 -179° 繞地球一圈（台灣用不到，但錯了很難看）
  let deltaLng = target.center.lng - from.lng
  if (deltaLng > 180) deltaLng -= 360
  if (deltaLng < -180) deltaLng += 360

  let frame = 0
  let startTime = 0
  const step = (now: number) => {
    if (startTime === 0) startTime = now
    const t = Math.min(1, (now - startTime) / durationMs)
    const k = ease(t)
    map.moveCamera({
      center: { lat: from.lat + (target.center.lat - from.lat) * k, lng: from.lng + deltaLng * k },
      zoom: from.zoom + (target.zoom - from.zoom) * k,
    })
    if (t < 1) frame = requestAnimationFrame(step)
    else frame = 0
  }
  frame = requestAnimationFrame(step)

  return () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }
}
