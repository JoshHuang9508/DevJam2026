/// <reference types="google.maps" />
/**
 * Google Maps JavaScript API 設定。
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY 必填，需在 Google Cloud Console 啟用 Maps JavaScript API。
 * MAP_ID 用於 Advanced Marker（沒有自訂樣式時可沿用 DEMO_MAP_ID）。
 */
export const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
export const GOOGLE_MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID'

/** 台北車站，作為無結果時的預設視角 */
export const DEFAULT_CENTER: google.maps.LatLngLiteral = { lat: 25.0478, lng: 121.517 }
export const DEFAULT_ZOOM = 11
export const MAX_FIT_ZOOM = 15
export const FIT_PADDING = 60
