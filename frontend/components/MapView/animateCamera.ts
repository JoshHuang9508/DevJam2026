import type { LngLatLike, Map as MapLibreMap } from 'maplibre-gl'

export interface CameraTarget {
  center: LngLatLike
  zoom: number
}

const ease = (value: number) => (
  value < 0.5 ? 4 * value * value * value : 1 - (-2 * value + 2) ** 3 / 2
)

export const CAMERA_DURATION_MS = 600

export function animateCamera(
  map: MapLibreMap,
  target: CameraTarget,
  durationMs = CAMERA_DURATION_MS,
): () => void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (durationMs <= 0 || reduced) {
    map.jumpTo({ center: target.center, zoom: target.zoom })
    return () => {}
  }

  map.easeTo({
    center: target.center,
    zoom: target.zoom,
    duration: durationMs,
    easing: ease,
  })

  return () => map.stop()
}
