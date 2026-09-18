'use client'

import { useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { inBounds, type MapBounds } from '@/lib/client/bounds'
import { rankColor, scorePercent } from '@/lib/client/score'
import type { ScoredListing } from '@/lib/types/listing'
import { animateCamera } from './animateCamera'
import { MapCard } from './MapCard'
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  FIT_PADDING,
  MAP_STYLE,
  MAX_FIT_ZOOM,
  SELECT_ZOOM,
} from './mapStyle'

const MARKER_SIZE = { base: 32, top: 38, active: 46 } as const

const markerZIndex = (index: number, total: number) => total - index

interface Props {
  results: ScoredListing[]
  hoveredId: string | null
  selectedId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string | null) => void
  showCard?: boolean
  fitToken?: number
}

type MapLibrary = typeof import('maplibre-gl')

type MarkerEntry = {
  marker: Marker
  el: HTMLButtonElement
  attached: boolean
}

export function MapView({
  results,
  hoveredId,
  selectedId,
  onHover,
  onSelect,
  showCard = true,
  fitToken = 0,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const libraryRef = useRef<MapLibrary | null>(null)
  const markersRef = useRef<Map<string, MarkerEntry>>(new Map())
  const cancelCameraRef = useRef<(() => void) | null>(null)
  const onHoverRef = useRef(onHover)
  const onSelectRef = useRef(onSelect)
  onHoverRef.current = onHover
  onSelectRef.current = onSelect

  const [map, setMap] = useState<MapLibreMap | null>(null)
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const container = containerRef.current
    const mapDiv = mapDivRef.current
    if (!container || !mapDiv) return

    let disposed = false
    let instance: MapLibreMap | null = null

    const stopCamera = () => {
      cancelCameraRef.current?.()
      cancelCameraRef.current = null
    }
    const measure = () => {
      setContainerSize({ width: container.clientWidth, height: container.clientHeight })
      mapRef.current?.resize()
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)

    void import('maplibre-gl')
      .then((maplibre) => {
        if (disposed) return
        libraryRef.current = maplibre
        // Next/Turbopack hashes worker filenames, but the worker still imports
        // ./maplibre-gl-shared.mjs by original name. Serve both from /public.
        maplibre.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')
        instance = new maplibre.Map({
          container: mapDiv,
          style: MAP_STYLE,
          center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
          zoom: DEFAULT_ZOOM,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        })
        instance.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right')
        instance.on('click', () => onSelectRef.current(null))
        instance.on('dragstart', stopCamera)
        mapDiv.addEventListener('wheel', stopCamera, { passive: true })
        mapRef.current = instance
        setMap(instance)
      })
      .catch((error) => {
        console.warn('[MapView] OpenStreetMap 地圖載入失敗', error)
      })

    return () => {
      disposed = true
      observer.disconnect()
      mapDiv.removeEventListener('wheel', stopCamera)
      stopCamera()
      markersRef.current.forEach(({ marker }) => marker.remove())
      markersRef.current.clear()
      instance?.remove()
      if (mapRef.current === instance) mapRef.current = null
      libraryRef.current = null
    }
  }, [])

  const [viewport, setViewport] = useState<MapBounds | null>(null)
  useEffect(() => {
    if (!map) return
    const sync = () => {
      const bounds = map.getBounds()
      const sw = bounds.getSouthWest()
      const ne = bounds.getNorthEast()
      setViewport({ south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng })
    }
    sync()
    map.on('moveend', sync)
    return () => {
      map.off('moveend', sync)
    }
  }, [map])

  useEffect(() => {
    markersRef.current.forEach(({ marker }) => marker.remove())
    markersRef.current.clear()
  }, [results])

  useEffect(() => {
    const maplibre = libraryRef.current
    if (!map || !maplibre) return

    const shouldShow = new Set<string>()
    results.forEach((result, index) => {
      const pinned = result.id === selectedId || result.id === hoveredId
      if (!pinned && viewport && !inBounds(result, viewport)) return
      shouldShow.add(result.id)

      let entry = markersRef.current.get(result.id)
      if (!entry) {
        const el = document.createElement('button')
        el.type = 'button'
        el.title = `${result.title}｜${scorePercent(result.score)} 分`
        el.textContent = String(index + 1)
        el.style.cssText = [
          'display:grid',
          'place-items:center',
          'cursor:pointer',
          'padding:0',
          'font:700 14px/1 ui-sans-serif,system-ui,sans-serif',
          'color:#fff',
          'border:3px solid #fff',
          'border-radius:9999px',
          'box-shadow:0 2px 6px rgb(15 23 42 / .4)',
          'transition:width .12s,height .12s,box-shadow .12s,opacity .12s',
        ].join(';')
        el.addEventListener('mouseenter', () => onHoverRef.current(result.id))
        el.addEventListener('mouseleave', () => onHoverRef.current(null))
        el.addEventListener('click', (event) => {
          event.stopPropagation()
          onSelectRef.current(result.id)
        })

        const marker = new maplibre.Marker({
          element: el,
          anchor: 'center',
          subpixelPositioning: true,
        }).setLngLat([result.lng, result.lat])
        entry = { marker, el, attached: false }
        markersRef.current.set(result.id, entry)
      }

      if (!entry.attached) {
        entry.marker.addTo(map)
        entry.attached = true
      }
    })

    markersRef.current.forEach((entry, id) => {
      if (!shouldShow.has(id) && entry.attached) {
        entry.marker.remove()
        entry.attached = false
      }
    })
  }, [map, results, viewport, selectedId, hoveredId])

  const lastFit = useRef(0)
  useEffect(() => {
    const maplibre = libraryRef.current
    if (!map || !maplibre || fitToken === lastFit.current) return
    lastFit.current = fitToken
    if (results.length === 0) return

    cancelCameraRef.current?.()
    cancelCameraRef.current = null
    const bounds = new maplibre.LngLatBounds()
    results.forEach((result) => bounds.extend([result.lng, result.lat]))
    map.fitBounds(bounds, {
      padding: FIT_PADDING,
      maxZoom: MAX_FIT_ZOOM,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600,
    })
  }, [map, fitToken, results])

  useEffect(() => {
    results.forEach((result, index) => {
      const entry = markersRef.current.get(result.id)
      if (!entry) return
      const active = result.id === hoveredId || result.id === selectedId
      const size = active ? MARKER_SIZE.active : index < 3 ? MARKER_SIZE.top : MARKER_SIZE.base
      entry.el.style.width = `${size}px`
      entry.el.style.height = `${size}px`
      entry.el.style.background = rankColor(index, results.length)
      entry.el.style.zIndex = String(active ? results.length + 1 : markerZIndex(index, results.length))
      entry.el.style.boxShadow = active
        ? '0 3px 12px rgb(15 23 42 / .5)'
        : '0 2px 6px rgb(15 23 42 / .4)'
      entry.el.style.opacity = hoveredId && !active ? '0.55' : '1'
    })
  }, [hoveredId, selectedId, results, viewport])

  useEffect(() => {
    if (!map || !selectedId) return
    const target = results.find((result) => result.id === selectedId)
    if (!target) return
    const zoom = Math.max(map.getZoom(), SELECT_ZOOM)
    cancelCameraRef.current?.()
    cancelCameraRef.current = animateCamera(map, {
      center: [target.lng, target.lat],
      zoom,
    })
    return () => {
      cancelCameraRef.current?.()
      cancelCameraRef.current = null
    }
  }, [map, selectedId, results])

  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const shownId = selectedId ?? hoveredId
    if (!map || !shownId) {
      setAnchor(null)
      return
    }
    const target = results.find((result) => result.id === shownId)
    if (!target) {
      setAnchor(null)
      return
    }

    let frame = 0
    const update = () => {
      frame = 0
      const point = map.project([target.lng, target.lat])
      setAnchor({ x: point.x, y: point.y })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    update()
    map.on('move', schedule)
    map.on('resize', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      map.off('move', schedule)
      map.off('resize', schedule)
    }
  }, [map, selectedId, hoveredId, results])

  const shownIndex = results.findIndex((result) => result.id === (selectedId ?? hoveredId))
  const shown = shownIndex === -1 ? null : results[shownIndex]

  return (
    <div ref={containerRef} className="relative h-full w-full bg-neutral-200" data-testid="map">
      <div ref={mapDivRef} style={{ position: 'absolute', inset: 0 }} />
      {showCard && shown && anchor && containerSize && (
        <MapCard
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
