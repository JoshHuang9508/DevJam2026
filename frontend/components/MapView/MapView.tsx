'use client'

import { useEffect, useRef, useState } from 'react'
import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { scoreColor, scorePercent } from '@/lib/client/score'
import type { ScoredListing } from '@/lib/types/listing'
import { CARD_GAP, CARD_H, CARD_W, MapCard } from './MapCard'
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  FIT_PADDING,
  GOOGLE_MAPS_API_KEY,
  GOOGLE_MAPS_MAP_ID,
  MAX_FIT_ZOOM,
} from './mapStyle'

interface Props {
  results: ScoredListing[]
  hoveredId: string | null
  selectedId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string | null) => void
}

type Libs = {
  Map: typeof google.maps.Map
  AdvancedMarkerElement: typeof google.maps.marker.AdvancedMarkerElement
  LatLngBounds: typeof google.maps.LatLngBounds
  OverlayView: typeof google.maps.OverlayView
}

// 整個 app 只會載入一次 Maps JS API，StrictMode 的二次掛載共用同一個 promise。
let libsPromise: Promise<Libs> | null = null
function loadLibs(): Promise<Libs> {
  if (!libsPromise) {
    setOptions({ key: GOOGLE_MAPS_API_KEY, v: 'weekly', language: 'zh-TW', region: 'TW' })
    libsPromise = Promise.all([importLibrary('maps'), importLibrary('marker'), importLibrary('core')])
      .then(([maps, marker, core]) => ({
        Map: maps.Map,
        AdvancedMarkerElement: marker.AdvancedMarkerElement,
        LatLngBounds: core.LatLngBounds,
        OverlayView: maps.OverlayView,
      }))
      .catch((err) => {
        libsPromise = null
        throw err
      })
  }
  return libsPromise
}

/**
 * 點位用 AdvancedMarkerElement 掛自訂 DOM，不用 data layer / 向量圖層。
 * 目前一次最多 30 筆（lib/scoring 的 MAX_RESULTS），這個量級用 DOM 綽綽有餘；
 * 之後換成真實資料要做 cluster 時再改成 marker clusterer。
 */
export function MapView({ results, hoveredId, selectedId, onHover, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const libsRef = useRef<Libs | null>(null)
  const overlayRef = useRef<google.maps.OverlayView | null>(null)
  const markersRef = useRef<
    Map<string, { marker: google.maps.marker.AdvancedMarkerElement; el: HTMLButtonElement }>
  >(new Map())
  // 事件處理器放 ref，marker 才不需要因為 props 變動而重建
  const onHoverRef = useRef(onHover)
  const onSelectRef = useRef(onSelect)
  onHoverRef.current = onHover
  onSelectRef.current = onSelect

  const [map, setMap] = useState<google.maps.Map | null>(null)

  // 容器尺寸放 state，而非在 render 時讀 DOM —— 否則 resize 後翻轉判斷會用到舊值，
  // 直到某個不相干的 state 變動才會補上。掛載時先量一次，之後跟著 ResizeObserver 更新。
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const container = containerRef.current
    const mapDiv = mapDivRef.current
    if (!container || !mapDiv) return
    setContainerSize({ width: container.clientWidth, height: container.clientHeight })

    let cancelled = false
    loadLibs()
      .then((libs) => {
        if (cancelled) return
        libsRef.current = libs
        // StrictMode 會 mount → unmount → mount，兩次都跑到這裡；同一個 container
        // 已經有 map 就沿用，不要疊第二張。
        if (mapRef.current && mapRef.current.getDiv() === mapDiv) {
          setMap(mapRef.current)
          return
        }
        const instance = new libs.Map(mapDiv, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          mapId: GOOGLE_MAPS_MAP_ID,
          disableDefaultUI: true,
          zoomControl: true,
          zoomControlOptions: { position: google.maps.ControlPosition.TOP_RIGHT },
          gestureHandling: 'greedy',
          clickableIcons: false,
        })
        mapRef.current = instance

        // 點空白處清除選取。Google 的 marker 點擊不會冒泡成 map 的 click，
        // 所以點在 marker 上不會把剛選到的物件立刻取消。
        instance.addListener('click', () => onSelectRef.current(null))

        // 螢幕座標換算用 OverlayView 取 projection，Maps API 沒有等價的 map.project()
        const overlay = new libs.OverlayView()
        overlay.onAdd = () => {}
        overlay.draw = () => {}
        overlay.onRemove = () => {}
        overlay.setMap(instance)
        overlayRef.current = overlay

        setMap(instance)
      })
      .catch((err) => {
        console.warn('[MapView] Google Maps 載入失敗', err)
      })

    const observer = new ResizeObserver(() => {
      setContainerSize({ width: container.clientWidth, height: container.clientHeight })
    })
    observer.observe(container)

    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [])

  // 結果更新 → 重建 marker 並 fitBounds
  useEffect(() => {
    const libs = libsRef.current
    if (!map || !libs) return

    markersRef.current.forEach(({ marker }) => { marker.map = null })
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
        // AdvancedMarker 把 content 的底部中心對齊座標點，下移一半高度才會置中
        'transform:translateY(50%)',
      ].join(';')
      el.addEventListener('mouseenter', () => onHoverRef.current(r.id))
      el.addEventListener('mouseleave', () => onHoverRef.current(null))

      const marker = new libs.AdvancedMarkerElement({
        map,
        position: { lat: r.lat, lng: r.lng },
        content: el,
        title: el.title,
        gmpClickable: true,
      })
      marker.addListener('gmp-click', () => onSelectRef.current(r.id))
      markersRef.current.set(r.id, { marker, el })
    })

    if (results.length === 0) return
    const bounds = new libs.LatLngBounds()
    for (const r of results) bounds.extend({ lat: r.lat, lng: r.lng })
    map.fitBounds(bounds, FIT_PADDING)
    // fitBounds 對單點或密集結果會拉到最大縮放，等相機停下來再夾一次上限
    const once = map.addListener('idle', () => {
      once.remove()
      const z = map.getZoom()
      if (z !== undefined && z > MAX_FIT_ZOOM) map.setZoom(MAX_FIT_ZOOM)
    })
  }, [map, results])

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
    if (!map || !selectedId) return
    const target = results.find((r) => r.id === selectedId)
    if (!target) return
    const center = { lat: target.lat, lng: target.lng }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) map.setCenter(center)
    else map.panTo(center)
    map.setZoom(15)
  }, [map, selectedId, results])

  // 卡片錨點：相機一動就重算螢幕座標。用 requestAnimationFrame 節流 —— bounds_changed
  // 在拖曳時每幀觸發，直接 setState 會抖動並掉幀。
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const shownId = selectedId ?? hoveredId
    if (!map || !shownId) { setAnchor(null); return }
    const target = results.find((r) => r.id === shownId)
    if (!target) { setAnchor(null); return }

    let frame = 0
    const update = () => {
      frame = 0
      // projection 要等 overlay 第一次 draw 之後才有，還沒好就先跳過，idle 會補跑
      const projection = overlayRef.current?.getProjection()
      if (!projection) return
      const point = projection.fromLatLngToContainerPixel(
        new google.maps.LatLng(target.lat, target.lng),
      )
      if (point) setAnchor({ x: point.x, y: point.y })
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }

    update()
    const listeners = [
      map.addListener('bounds_changed', schedule),
      map.addListener('idle', schedule),
      map.addListener('drag', schedule),
    ]
    return () => {
      if (frame) cancelAnimationFrame(frame)
      listeners.forEach((l) => l.remove())
    }
  }, [map, selectedId, hoveredId, results])

  const shown = results.find((r) => r.id === (selectedId ?? hoveredId)) ?? null
  const flipX = anchor !== null && containerSize !== null && anchor.x > containerSize.width - (CARD_W + CARD_GAP)
  const flipY = anchor !== null && containerSize !== null && anchor.y > containerSize.height - (CARD_H + CARD_GAP)

  return (
    <div ref={containerRef} className="relative h-full w-full bg-neutral-200" data-testid="map">
      <div ref={mapDivRef} className="absolute inset-0" />
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
