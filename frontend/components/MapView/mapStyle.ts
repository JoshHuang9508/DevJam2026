/// <reference types="google.maps" />
/**
 * Google Maps JavaScript API 設定。
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY 必填，需在 Google Cloud Console 啟用 Maps JavaScript API。
 * MAP_ID 用於 Advanced Marker（沒有自訂樣式時可沿用 DEMO_MAP_ID）。
 *
 * 地圖配色沒辦法在程式碼裡設定：MapOptions.styles 只要同時給了 mapId 就會被忽略
 * （Google 的規定，兩種樣式機制不能混用），而 AdvancedMarkerElement 一定要 mapId。
 * 所以低彩度樣式走 Cloud Console：
 *   1. Google Cloud Console → Google Maps Platform → Map styles → Create new style
 *   2. 選 Import JSON，貼上本目錄的 cloud-style.json → Save
 *   3. 該樣式頁的 Map IDs 分頁 → Add map ID（type 選 JavaScript / Vector）
 *   4. 把產生的 Map ID 填進 .env.local 的 NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
 * cloud-style.json 的取捨：底圖降到灰白＋單一水藍＋公園綠，關掉行政區界、地方道路標籤、
 * 一般 POI 標籤，但保留 poi.business（店家）、poi.medical（醫院診所）、poi.school 與
 * transit.station 的標籤與圖示 —— 找房時這幾類是判斷依據，不是雜訊。
 */
export const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
export const GOOGLE_MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID'

/** 台北車站，作為無結果時的預設視角 */
export const DEFAULT_CENTER: google.maps.LatLngLiteral = { lat: 25.0478, lng: 121.517 }
export const DEFAULT_ZOOM = 11
export const MAX_FIT_ZOOM = 15
export const FIT_PADDING = 60
/** 選取單一物件時至少放大到這一級 */
export const SELECT_ZOOM = 15
