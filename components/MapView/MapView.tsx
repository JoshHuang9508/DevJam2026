'use client'

import { useEffect, useRef } from 'react'
import {
  Map as MapLibreMapCtor,
  NavigationControl,
  LngLatBounds,
  type GeoJSONSource,
  type Map as MapLibreMap,
} from 'maplibre-gl'
import type { ScoredListing } from '@/lib/types/listing'
import { DEFAULT_CENTER, DEFAULT_ZOOM, OSM_RASTER_STYLE } from './mapStyle'

const SOURCE_ID = 'listings'

interface Props {
  results: ScoredListing[]
  hoveredId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}

// setFeatureState 只認 GeoJSON Feature 頂層的 id（number | string），不是 properties 裡的欄位。
// 這裡以 results 陣列的 index 作為數值型 feature id，hover 時再用同一個 index 對應回去。
function toGeoJson(results: ScoredListing[]) {
  return {
    type: 'FeatureCollection' as const,
    features: results.map((r, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
      properties: { id: r.id, score: r.score, title: r.title },
    })),
  }
}

export function MapView({ results, hoveredId, onHover, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const readyRef = useRef(false)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new MapLibreMapCtor({
      container: containerRef.current,
      style: OSM_RASTER_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')

    // 圖磚載入失敗時降級為灰底，點位仍照常顯示
    map.on('error', (e) => { console.warn('[MapView] 地圖錯誤', e.error) })

    map.on('load', () => {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: toGeoJson([]),
        cluster: true,
        clusterRadius: 45,
        clusterMaxZoom: 13,
      })

      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#1e40af',
          'circle-opacity': 0.85,
          'circle-radius': ['step', ['get', 'point_count'], 16, 5, 22, 15, 28],
        },
      })
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
        paint: { 'text-color': '#ffffff' },
      })
      map.addLayer({
        id: 'points',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          // 分數越高越暖色
          'circle-color': [
            'interpolate', ['linear'], ['get', 'score'],
            0, '#94a3b8', 0.5, '#f59e0b', 0.8, '#dc2626',
          ],
          'circle-radius': ['case', ['boolean', ['feature-state', 'hovered'], false], 12, 8],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })

      map.on('mouseenter', 'points', (e) => {
        map.getCanvas().style.cursor = 'pointer'
        const id = e.features?.[0]?.properties?.id
        if (typeof id === 'string') onHover(id)
      })
      map.on('mouseleave', 'points', () => {
        map.getCanvas().style.cursor = ''
        onHover(null)
      })
      map.on('click', 'points', (e) => {
        const id = e.features?.[0]?.properties?.id
        if (typeof id === 'string') onSelect(id)
      })

      readyRef.current = true
    })

    return () => {
      map.remove()
      mapRef.current = null
      readyRef.current = false
    }
    // onHover / onSelect 以 ref 之外的方式傳入會導致地圖重建，故刻意只在掛載時執行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 結果更新 → 換資料並 fitBounds
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const apply = () => {
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
      if (!source) return
      source.setData(toGeoJson(results))
      if (results.length === 0) return
      const bounds = new LngLatBounds(
        [results[0].lng, results[0].lat],
        [results[0].lng, results[0].lat],
      )
      for (const r of results) bounds.extend([r.lng, r.lat])
      map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 600 })
    }

    if (readyRef.current) apply()
    else map.once('load', apply)
  }, [results])

  // 卡片 hover → marker 放大（以 index 作為數值型 feature id，見 toGeoJson 註解）
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    results.forEach((r, i) => {
      map.setFeatureState(
        { source: SOURCE_ID, id: i },
        { hovered: r.id === hoveredId },
      )
    })
  }, [hoveredId, results])

  return <div ref={containerRef} className="h-full w-full bg-neutral-200" data-testid="map" />
}
