import type { MapOptions } from 'maplibre-gl'

export const MAP_STYLE: NonNullable<MapOptions['style']> = (
  process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron'
)

export const DEFAULT_CENTER = { lat: 25.0478, lng: 121.517 } as const
export const DEFAULT_ZOOM = 11
export const MAX_FIT_ZOOM = 15
export const FIT_PADDING = 60
export const SELECT_ZOOM = 15
