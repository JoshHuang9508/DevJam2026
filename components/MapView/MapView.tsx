'use client'

import { useEffect, useRef } from 'react'
import {
  Map as MapLibreMapCtor,
  Marker,
  NavigationControl,
  LngLatBounds,
  type Map as MapLibreMap,
} from 'maplibre-gl'
import { scoreColor, scorePercent } from '@/lib/client/score'
import type { ScoredListing } from '@/lib/types/listing'
import { DEFAULT_CENTER, DEFAULT_ZOOM, OSM_RASTER_STYLE } from './mapStyle'

interface Props {
  results: ScoredListing[]
  hoveredId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}

/**
 * 點位用 DOM Marker，不用 geojson source + circle layer。
 *
 * 原因：maplibre 的 geojson source 一律在 web worker 裡切磚，而這個 Next/Turbopack
 * 環境下 worker 一建立就被關掉，source 會永遠停在 loading —— setData 收得到資料、
 * fitBounds 也照跑，但 querySourceFeatures 恆為 0，一個點都畫不出來，且不拋任何錯誤。
 * DOM Marker 完全不經過 worker。目前一次最多 30 筆（lib/scoring 的 MAX_RESULTS），
 * 這個量級用 DOM 綽綽有餘；之後換成真實資料要回到 cluster 圖層時，得先解決 worker。
 */
export function MapView({ results, hoveredId, onHover, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Map<string, { marker: Marker; el: HTMLButtonElement }>>(new Map())
  const removalTimer = useRef<number | null>(null)
  // 事件處理器放 ref，marker 才不需要因為 props 變動而重建
  const onHoverRef = useRef(onHover)
  const onSelectRef = useRef(onSelect)
  onHoverRef.current = onHover
  onSelectRef.current = onSelect

  useEffect(() => {
    if (!containerRef.current) return

    // StrictMode 會 mount → unmount → mount。立刻 map.remove() 會讓第二個 map
    // 接手到被拆掉一半的狀態，因此延後銷毀，第二次 mount 直接沿用同一個 instance。
    if (removalTimer.current !== null) {
      clearTimeout(removalTimer.current)
      removalTimer.current = null
    }
    if (mapRef.current) return

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

    return () => {
      removalTimer.current = window.setTimeout(() => {
        markersRef.current.forEach(({ marker }) => marker.remove())
        markersRef.current.clear()
        mapRef.current?.remove()
        mapRef.current = null
        removalTimer.current = null
      }, 0)
    }
  }, [])

  // 結果更新 → 重建 marker 並 fitBounds
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach(({ marker }) => marker.remove())
    markersRef.current.clear()

    results.forEach((r, i) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.title = `${r.title}｜${scorePercent(r.score)} 分`
      el.textContent = String(i + 1)
      el.style.cssText = [
        'display:grid', 'place-items:center', 'cursor:pointer', 'padding:0',
        'font:600 11px/1 ui-sans-serif,system-ui,sans-serif', 'color:#fff',
        'border:2px solid #fff', 'border-radius:9999px',
        'box-shadow:0 1px 4px rgb(15 23 42 / .35)',
        'transition:width .12s,height .12s,box-shadow .12s',
      ].join(';')
      el.addEventListener('mouseenter', () => onHoverRef.current(r.id))
      el.addEventListener('mouseleave', () => onHoverRef.current(null))
      el.addEventListener('click', () => onSelectRef.current(r.id))

      const marker = new Marker({ element: el }).setLngLat([r.lng, r.lat]).addTo(map)
      markersRef.current.set(r.id, { marker, el })
    })

    if (results.length === 0) return
    const bounds = new LngLatBounds([results[0].lng, results[0].lat], [results[0].lng, results[0].lat])
    for (const r of results) bounds.extend([r.lng, r.lat])
    map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 600 })
  }, [results])

  // 卡片 hover ↔ marker 放大。就地改樣式，不重建 marker。
  useEffect(() => {
    results.forEach((r, i) => {
      const entry = markersRef.current.get(r.id)
      if (!entry) return
      const active = r.id === hoveredId
      const size = active ? 30 : i < 3 ? 24 : 20
      entry.el.style.width = `${size}px`
      entry.el.style.height = `${size}px`
      entry.el.style.background = scoreColor(r.score)
      entry.el.style.zIndex = active ? '10' : '1'
      entry.el.style.boxShadow = active
        ? '0 2px 10px rgb(15 23 42 / .45)'
        : '0 1px 4px rgb(15 23 42 / .35)'
      entry.el.style.opacity = hoveredId && !active ? '0.55' : '1'
    })
  }, [hoveredId, results])

  return <div ref={containerRef} className="h-full w-full bg-neutral-200" data-testid="map" />
}
