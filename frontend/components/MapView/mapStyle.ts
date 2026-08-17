import type { StyleSpecification } from 'maplibre-gl'

/**
 * OSM 原生 raster 圖磚，無需 API key。
 * 僅適用於 demo 流量；上線需自架圖磚或改用付費供應商（見 spec 風險章節）。
 */
export const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

/** 台北車站，作為無結果時的預設視角 */
export const DEFAULT_CENTER: [number, number] = [121.5170, 25.0478]
export const DEFAULT_ZOOM = 11
