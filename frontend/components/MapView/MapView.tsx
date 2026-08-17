'use client'

import { useEffect, useRef, useState } from 'react'
import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { rankColor, scorePercent } from '@/lib/client/score'
import type { MapBounds } from '@/lib/scoring'
import type { ScoredListing } from '@/lib/types/listing'
import { animateCamera } from './animateCamera'
import { MapCard } from './MapCard'
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  FIT_PADDING,
  GOOGLE_MAPS_API_KEY,
  GOOGLE_MAPS_MAP_ID,
  MAX_FIT_ZOOM,
  SELECT_ZOOM,
} from './mapStyle'

/** 圖示直徑（px）。前三名放大一階當視覺提示，hover／選取再放大一階。 */
const MARKER_SIZE = { base: 32, top: 38, active: 46 } as const

/** 名次越前面圖層越高：第 1 名拿到最大值，最後一名拿 1。 */
const markerZIndex = (index: number, total: number) => total - index

interface Props {
  results: ScoredListing[]
  hoveredId: string | null
  selectedId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string | null) => void
  /** 關掉浮動卡片。行動版下方的 ListingDeck 已經在顯示同一筆，浮層只會擋住地圖。 */
  showCard?: boolean
  /** 遞增時把相機帶到結果上。只有「新的搜尋」該遞增，拖地圖不該。 */
  fitToken?: number
  /** 視角停下來時回報，供上層依視角重新取結果。 */
  onBoundsChange?: (bounds: MapBounds) => void
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
 * 一次最多 50 筆（useSearchState 的 MAP_LIMIT），視角一動就重取。
 * 這個量級用 DOM 綽綽有餘；哪天要一次顯示整個候選池才需要 marker clusterer。
 */
export function MapView({
  results, hoveredId, selectedId, onHover, onSelect, showCard = true,
  fitToken = 0, onBoundsChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const libsRef = useRef<Libs | null>(null)
  const overlayRef = useRef<google.maps.OverlayView | null>(null)
  const markersRef = useRef<
    Map<string, { marker: google.maps.marker.AdvancedMarkerElement; el: HTMLButtonElement }>
  >(new Map())
  // 進行中的相機動畫的取消函式
  const cancelCameraRef = useRef<(() => void) | null>(null)
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
          // vector + fractional zoom 才能把 zoom 連續插值；raster 會把中間的小數 zoom
          // 夾成整數，animateCamera 的縮放就變成一格一格跳。
          renderingType: google.maps.RenderingType.VECTOR,
          isFractionalZoomEnabled: true,
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

        // 使用者一動手就放掉相機動畫，否則自己的拖曳／縮放會被動畫每一幀拉回去
        const stop = () => { cancelCameraRef.current?.(); cancelCameraRef.current = null }
        instance.addListener('dragstart', stop)
        mapDiv.addEventListener('wheel', stop, { passive: true })

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

  // 結果更新 → 只重建 marker。相機由下一個 effect 依 fitToken 決定，
  // 兩件事必須分開：使用者拖地圖會換一批結果，那時候動相機就會把他拖走。
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
        'font:700 14px/1 ui-sans-serif,system-ui,sans-serif', 'color:#fff',
        'border:3px solid #fff', 'border-radius:9999px',
        'box-shadow:0 2px 6px rgb(15 23 42 / .4)',
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
        zIndex: markerZIndex(i, results.length),
      })
      marker.addListener('gmp-click', () => onSelectRef.current(r.id))
      markersRef.current.set(r.id, { marker, el })
    })

  }, [map, results])

  // 新的搜尋才把相機帶到結果上。fitToken 由 useSearchState 在「非視角觸發」的
  // 查詢後遞增；視角觸發的查詢不會動它，相機因此留在使用者放的位置。
  const lastFit = useRef(0)
  useEffect(() => {
    const libs = libsRef.current
    if (!map || !libs || fitToken === lastFit.current) return
    lastFit.current = fitToken
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
  }, [map, fitToken, results])

  // 視角停下來就回報。用 idle 而不是 bounds_changed：後者在拖曳過程中
  // 每一影格都會觸發，等於每秒打幾十次 /api/rank。
  const onBoundsRef = useRef(onBoundsChange)
  onBoundsRef.current = onBoundsChange
  useEffect(() => {
    if (!map) return
    const listener = map.addListener('idle', () => {
      const b = map.getBounds()
      if (!b || !onBoundsRef.current) return
      const sw = b.getSouthWest()
      const ne = b.getNorthEast()
      onBoundsRef.current({ south: sw.lat(), west: sw.lng(), north: ne.lat(), east: ne.lng() })
    })
    return () => listener.remove()
  }, [map])

  // 卡片 hover ↔ marker 放大。就地改樣式，不重建 marker。
  useEffect(() => {
    results.forEach((r, i) => {
      const entry = markersRef.current.get(r.id)
      if (!entry) return
      const active = r.id === hoveredId || r.id === selectedId
      const size = active ? MARKER_SIZE.active : i < 3 ? MARKER_SIZE.top : MARKER_SIZE.base
      entry.el.style.width = `${size}px`
      entry.el.style.height = `${size}px`
      // 名次上色，不是分數上色：一批結果的分數常擠在很窄的區間，見 lib/client/score.ts
      entry.el.style.background = rankColor(i, results.length)
      // 疊放順序要設在 marker 上，不是 content 的 CSS z-index —— Google 把每個 marker
      // 包在自己的圖層容器裡，content 的 z-index 只在那個容器內部有效，跨 marker 不生效。
      entry.marker.zIndex = active ? results.length + 1 : markerZIndex(i, results.length)
      entry.el.style.boxShadow = active
        ? '0 3px 12px rgb(15 23 42 / .5)'
        : '0 2px 6px rgb(15 23 42 / .4)'
      entry.el.style.opacity = hoveredId && !active ? '0.55' : '1'
    })
  }, [hoveredId, selectedId, results])

  // 選取 → 平滑移動並放大置中。center 與 zoom 一起插值，不用 panTo + setZoom：
  // 那組合是「補間平移」後接「瞬間縮放」，切物件時會看到兩段式的跳動。
  useEffect(() => {
    if (!map || !selectedId) return
    const target = results.find((r) => r.id === selectedId)
    if (!target) return
    // 已經比 SELECT_ZOOM 近就維持現況：使用者自己放大過，再被拉遠回 15 很錯亂
    const zoom = Math.max(map.getZoom() ?? SELECT_ZOOM, SELECT_ZOOM)
    cancelCameraRef.current?.()
    cancelCameraRef.current = animateCamera(map, { center: { lat: target.lat, lng: target.lng }, zoom })
    return () => { cancelCameraRef.current?.(); cancelCameraRef.current = null }
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

  const shownIndex = results.findIndex((r) => r.id === (selectedId ?? hoveredId))
  const shown = shownIndex === -1 ? null : results[shownIndex]

  return (
    <div ref={containerRef} className="relative h-full w-full bg-neutral-200" data-testid="map">
      <div ref={mapDivRef} className="absolute inset-0" />
      {showCard && shown && anchor && containerSize && (
        <MapCard
          // 換一筆物件就重建，展開狀態才會回到收合；同一張卡片沿用會帶著上一筆的展開狀態
          key={shown.id}
          listing={shown}
          rank={shownIndex + 1}
          anchor={anchor}
          container={containerSize}
          onHover={onHover}
        />
      )}
    </div>
  )
}
