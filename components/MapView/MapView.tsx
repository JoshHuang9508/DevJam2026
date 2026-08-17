'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Map as MapLibreMapCtor,
  Marker,
  NavigationControl,
  LngLatBounds,
  type Map as MapLibreMap,
} from 'maplibre-gl'
import { scoreColor, scorePercent } from '@/lib/client/score'
import type { ScoredListing } from '@/lib/types/listing'
import { CARD_GAP, CARD_H, CARD_W, MapCard } from './MapCard'
import { DEFAULT_CENTER, DEFAULT_ZOOM, OSM_RASTER_STYLE } from './mapStyle'

interface Props {
  results: ScoredListing[]
  hoveredId: string | null
  selectedId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string | null) => void
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
export function MapView({ results, hoveredId, selectedId, onHover, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Map<string, { marker: Marker; el: HTMLButtonElement }>>(new Map())
  const removalTimer = useRef<number | null>(null)
  // 事件處理器放 ref，marker 才不需要因為 props 變動而重建
  const onHoverRef = useRef(onHover)
  const onSelectRef = useRef(onSelect)
  onHoverRef.current = onHover
  onSelectRef.current = onSelect

  // 容器尺寸放 state，而非在 render 時讀 DOM —— 否則 resize 後翻轉判斷會用到舊值，
  // 直到某個不相干的 state 變動才會補上。掛載時先量一次，之後跟著 map 的 resize 事件更新。
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // StrictMode 會 mount → unmount → mount。立刻 map.remove() 會讓第二個 map
    // 接手到被拆掉一半的狀態，因此延後銷毀，第二次 mount 直接沿用同一個 instance。
    if (removalTimer.current !== null) {
      clearTimeout(removalTimer.current)
      removalTimer.current = null
    }
    setContainerSize({
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    })
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

    // 點空白處清除選取。marker 的 click handler 會 stopPropagation，
    // 所以點在 marker 上不會冒泡到這裡把剛選到的物件立刻取消。
    map.on('click', () => onSelectRef.current(null))

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
      // stopPropagation：否則這個 click 會冒泡到地圖的 click handler，
      // 剛選到的物件立刻被地圖那邊的「點空白處清除選取」取消。
      el.addEventListener('click', (event) => {
        event.stopPropagation()
        onSelectRef.current(r.id)
      })

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

  // 選取 → 放大置中
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedId) return
    const target = results.find((r) => r.id === selectedId)
    if (!target) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const options = { center: [target.lng, target.lat] as [number, number], zoom: 15 }
    if (reduced) map.jumpTo(options)
    else map.flyTo({ ...options, duration: 600 })
  }, [selectedId, results])

  // 卡片錨點：相機一動就重算螢幕座標。用 requestAnimationFrame 節流 —— move 在拖曳時
  // 每幀觸發，直接 setState 會抖動並掉幀。resize 事件同時把 containerSize 更新到最新，
  // 讓翻轉判斷（render 時算 flipX/flipY）不會用到掛載當下量到的舊尺寸。
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const map = mapRef.current
    const shownId = selectedId ?? hoveredId
    if (!map || !shownId) { setAnchor(null); return }
    const target = results.find((r) => r.id === shownId)
    if (!target) { setAnchor(null); return }

    if (containerRef.current) {
      setContainerSize({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      })
    }

    let frame = 0
    const update = () => {
      frame = 0
      const p = map.project([target.lng, target.lat])
      setAnchor({ x: p.x, y: p.y })
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    const onResize = () => {
      schedule()
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    }

    update()
    map.on('move', schedule)
    map.on('zoom', schedule)
    map.on('resize', onResize)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      map.off('move', schedule)
      map.off('zoom', schedule)
      map.off('resize', onResize)
    }
  }, [selectedId, hoveredId, results])

  const shown = results.find((r) => r.id === (selectedId ?? hoveredId)) ?? null
  const flipX = anchor !== null && containerSize !== null && anchor.x > containerSize.width - (CARD_W + CARD_GAP)
  const flipY = anchor !== null && containerSize !== null && anchor.y > containerSize.height - (CARD_H + CARD_GAP)

  return (
    <div ref={containerRef} className="relative h-full w-full bg-neutral-200" data-testid="map">
      {shown && anchor && (
        <MapCard
          listing={shown}
          x={anchor.x}
          y={anchor.y}
          flipX={flipX}
          flipY={flipY}
          pinned={shown.id === selectedId}
          onClose={() => onSelect(null)}
        />
      )}
    </div>
  )
}
