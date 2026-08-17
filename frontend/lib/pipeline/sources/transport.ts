import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { log } from '../util'
import type { Point } from './geo'

/**
 * 交通站點與線形圖資，全部來自 OpenStreetMap。
 *
 * 為什麼不用官方來源：台鐵／高鐵／各都會捷運的權威資料在 TDX，但那要註冊並等人工審核。
 * OSM 的站點座標對「最近的車站有多遠」這個用途已經足夠，而且一次查詢就涵蓋全台所有
 * 系統（北捷、中捷、高捷、桃捷、台鐵、高鐵），不像 data.taipei 只有北捷。
 *
 * 授權：ODbL 1.0，必須標示「© OpenStreetMap contributors」。
 */

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'
const TAIWAN_AREA = '["boundary"="administrative"]["admin_level"="2"]["name:en"="Taiwan"]'

export interface TransportIndex {
  /** 台鐵、高鐵車站 */
  trainStations: Point[]
  /** 各都會捷運／輕軌站與出入口 */
  metroStations: Point[]
  /** 公車與客運站牌 */
  busStops: Point[]
  /** 主要道路的取樣點（噪音代理） */
  mainRoadPoints: Point[]
  /** 鐵軌的取樣點（噪音代理） */
  railwayPoints: Point[]
}

/**
 * 站點類查詢。用 `out center` 就夠 —— 車站是點或小面，中心點誤差在幾十公尺內。
 */
const POINT_QUERY = `
[out:json][timeout:600];
area${TAIWAN_AREA}->.tw;
(
  nwr["railway"="station"]["station"!="subway"](area.tw);
  nwr["railway"="halt"](area.tw);
  nwr["railway"="station"]["station"="subway"](area.tw);
  nwr["railway"="subway_entrance"](area.tw);
  nwr["station"="light_rail"](area.tw);
  nwr["highway"="bus_stop"](area.tw);
);
out center;
`.trim()

/**
 * 線形查詢。道路與鐵軌必須拿實際幾何（`out geom`），不能用 `out center` ——
 * 一條縱貫線的「中心點」可能在幾十公里外，用它算距離毫無意義。
 */
const LINE_QUERY = `
[out:json][timeout:900];
area${TAIWAN_AREA}->.tw;
(
  way["highway"~"^(motorway|trunk|primary)$"](area.tw);
  way["railway"="rail"]["service"!~"."](area.tw);
);
out geom;
`.trim()

interface OverpassElement {
  type?: string
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  geometry?: { lat: number; lon: number }[]
  tags?: Record<string, string>
}

export async function fetchTransport(cacheDir: string): Promise<TransportIndex> {
  const [points, lines] = await Promise.all([
    overpass(POINT_QUERY, `${cacheDir}/osm-transport-points.json`),
    overpass(LINE_QUERY, `${cacheDir}/osm-transport-lines.json`),
  ])

  const index: TransportIndex = {
    trainStations: [], metroStations: [], busStops: [], mainRoadPoints: [], railwayPoints: [],
  }

  for (const element of points) {
    const lat = element.lat ?? element.center?.lat
    const lon = element.lon ?? element.center?.lon
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const p = { lat: lat as number, lng: lon as number }
    const tags = element.tags ?? {}

    if (tags.highway === 'bus_stop') index.busStops.push(p)
    else if (tags.railway === 'subway_entrance' || tags.station === 'subway' || tags.station === 'light_rail') index.metroStations.push(p)
    else if (tags.railway === 'station' || tags.railway === 'halt') index.trainStations.push(p)
  }

  for (const element of lines) {
    const geometry = element.geometry ?? []
    if (geometry.length === 0) continue
    const tags = element.tags ?? {}
    const target = tags.railway === 'rail' ? index.railwayPoints : index.mainRoadPoints
    // 每隔幾個節點取一個：完整幾何是百萬級點數，而「最近的主要道路有多遠」
    // 只需要幾十公尺的解析度。節點間距通常 10~50m，取樣後仍在誤差容許內。
    for (let i = 0; i < geometry.length; i += SAMPLE_EVERY) {
      target.push({ lat: geometry[i].lat, lng: geometry[i].lon })
    }
    // 最後一點一定要留，否則長路段的末端會被整段忽略
    const last = geometry[geometry.length - 1]
    target.push({ lat: last.lat, lng: last.lon })
  }

  log('transport', `台鐵高鐵 ${index.trainStations.length}、捷運 ${index.metroStations.length}、`
    + `公車站 ${index.busStops.length}、主要道路取樣 ${index.mainRoadPoints.length}、鐵軌取樣 ${index.railwayPoints.length}`)
  return index
}

const SAMPLE_EVERY = 4

async function overpass(query: string, cachePath: string): Promise<OverpassElement[]> {
  let raw: string
  // 這些圖資以年為單位變動，而 Overpass 每個 IP 只有 2 個並行 slot、
  // 每天 1GB 的 fair use。快取 30 天，別把人家的免費服務當自己的資料庫。
  if (existsSync(cachePath) && Date.now() - statSync(cachePath).mtimeMs < 30 * 86400_000) {
    raw = readFileSync(cachePath, 'utf-8')
  } else {
    const response = await fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'anjia-housing-agent/0.1 (data pipeline; github.com/JoshHuang9508/DevJam2026)',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(900_000),
    })
    if (!response.ok) throw new Error(`Overpass ${response.status} ${response.statusText}`)
    raw = await response.text()
    mkdirSync(dirname(cachePath), { recursive: true })
    writeFileSync(cachePath, raw)
  }
  return (JSON.parse(raw) as { elements?: OverpassElement[] }).elements ?? []
}
