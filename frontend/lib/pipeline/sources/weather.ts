import type { Point } from './geo'
import { fetchCached, haversineMeters, log } from '../util'

/**
 * 氣候與空品。這兩個都需要免費金鑰，沒有金鑰就整段略過而不是讓 pipeline 掛掉。
 *
 * 兩者的空間解析度都很低（大台北只有 6 個氣候測站、約 10 個空品測站），
 * 所以是「最近測站」而不是逐點內插 —— 假裝有更高的精度只會誤導。
 */

export interface StationValue extends Point {
  annualTemp: number | null
  summerTemp: number | null
  winterTemp: number | null
  rainDays: number | null
  humidity: number | null
  sunHours: number | null
}

/* ------------------------------------------------------------------ */
/* 中央氣象署 氣候平均值 1991-2020                                      */
/* ------------------------------------------------------------------ */

const CWA_NORMALS = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/C-B0027-001'
const CWA_STATIONS = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/C-B0074-001'

/**
 * 1991-2020 氣候平均值。這是十年才換一版的統計值，不是天氣預報。
 *
 * 要打**兩支** API：C-B0027-001 只給 StationID 與統計值，**沒有經緯度**，
 * 座標得從 C-B0074-001（測站基本資料）用 StationID join 回來。
 * 少了這一步就沒辦法做最近測站配對。
 */
export async function fetchClimateStations(cacheDir: string, apiKey?: string): Promise<StationValue[]> {
  if (!apiKey) {
    log('climate', '沒有 CWA_API_KEY，略過氣候資料（欄位保持 null）')
    return []
  }
  const auth = `Authorization=${encodeURIComponent(apiKey)}&format=JSON`

  const [normalsBuf, metaBuf] = await Promise.all([
    fetchCached(`${CWA_NORMALS}?${auth}`, `${cacheDir}/cwa-normals.json`, { maxAgeMs: 30 * 86400_000 }),
    fetchCached(`${CWA_STATIONS}?${auth}`, `${cacheDir}/cwa-stations.json`, { maxAgeMs: 30 * 86400_000 }),
  ])

  // 座標表。同一個 StationID 可能有已撤銷的舊站，後出現的不覆蓋先出現的有效站。
  const coords = new Map<string, { lat: number; lng: number }>()
  const metaJson = JSON.parse(new TextDecoder().decode(metaBuf)) as CwaStationMeta
  for (const st of metaJson.records?.data?.stationStatus?.station ?? []) {
    const lat = Number(st.StationLatitude)
    const lng = Number(st.StationLongitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (!coords.has(st.StationID)) coords.set(st.StationID, { lat, lng })
  }

  const json = JSON.parse(new TextDecoder().decode(normalsBuf)) as CwaNormals
  // records 是 result 的**兄弟**不是子節點，照直覺寫 result.records 會拿到 undefined
  const locations = json.records?.data?.surfaceObs?.location ?? []
  const stations: StationValue[] = []

  for (const location of locations) {
    const id = location.station?.StationID
    const point = id ? coords.get(id) : undefined
    if (!point) continue

    // stationObsStatistics 是**物件**（依氣象要素當 key），不是陣列
    const stats = location.stationObsStatistics ?? {}
    const temps = stats.AirTemperature?.monthly ?? []
    const rain = stats.Precipitation?.monthly ?? []
    const humid = stats.RelativeHumidity?.monthly ?? []
    const sun = stats.SunshineDuration?.monthly ?? []
    if (temps.length === 0) continue

    stations.push({
      ...point,
      annualTemp: mean(temps.map((m) => num(m.Mean))),
      // 7-8 月與 1-2 月用月份索引，不找極值 —— 極值會挑到單一異常月
      summerTemp: mean([temps[6], temps[7]].map((m) => num(m?.Mean))),
      winterTemp: mean([temps[0], temps[1]].map((m) => num(m?.Mean))),
      rainDays: sum(rain.map((m) => num(m.GE01Days))),
      humidity: mean(humid.map((m) => num(m.Mean))),
      sunHours: sum(sun.map((m) => num(m.Total))),
    })
  }

  log('climate', `${stations.length}/${locations.length} 個氣候測站（1991-2020 平均值，含座標）`)
  return stations
}

interface MonthlyEntry { Month?: string; Mean?: string | number; GE01Days?: string | number; Total?: string | number }
interface ElementBlock { monthly?: MonthlyEntry[] }
interface CwaNormals {
  records?: {
    data?: {
      surfaceObs?: {
        location?: {
          station?: { StationID?: string; StationName?: string }
          stationObsStatistics?: {
            AirTemperature?: ElementBlock
            Precipitation?: ElementBlock
            RelativeHumidity?: ElementBlock
            SunshineDuration?: ElementBlock
          }
        }[]
      }
    }
  }
}
interface CwaStationMeta {
  records?: {
    data?: {
      stationStatus?: {
        station?: { StationID: string; StationLatitude?: string | number; StationLongitude?: string | number }[]
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 環境部 空氣品質                                                      */
/* ------------------------------------------------------------------ */

const MOENV_AQI = 'https://data.moenv.gov.tw/api/v2/aqx_p_432'
const MOENV_AQI_HISTORY = 'https://data.moenv.gov.tw/api/v2/aqx_p_488'
/** 取最近幾個月算平均。逐時值一天內就能差三倍，單一快照當不了「這裡空氣好不好」。 */
const AQI_MONTHS = 3

export interface AqiStation extends Point { aqi: number }

/**
 * 空品測站的**多月平均** AQI。
 *
 * 原本抓 aqx_p_432（逐時即時值）直接當 aqi_mean —— 那是快照不是平均，
 * 下雨天全台都會看起來很乾淨，欄位名卻叫 mean，會讓人以為是長期水準。
 * 改成抓 aqx_p_488 歷史資料取最近幾個月平均；歷史抓不到才退回即時值，
 * 並在日誌講明退回了。
 */
export async function fetchAqiStations(cacheDir: string, apiKey?: string, now = new Date()): Promise<AqiStation[]> {
  if (!apiKey) {
    log('aqi', '沒有 MOENV_API_KEY，略過空品資料（欄位保持 null）')
    return []
  }

  const sums = new Map<string, { lat: number; lng: number; total: number; n: number }>()
  let months = 0
  for (let i = 1; i <= AQI_MONTHS; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const ym = `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}`
    try {
      // 參數是 year_month，不是 filters —— 用 filters 會回 HTTP 500「查詢條件存在未知欄位」
      const url = `${MOENV_AQI_HISTORY}?api_key=${encodeURIComponent(apiKey)}&limit=1000&format=JSON&year_month=${ym}`
      const buf = await fetchCached(url, `${cacheDir}/moenv-aqi-${ym}.json`, { maxAgeMs: 30 * 86400_000 })
      const rows = toRows(new TextDecoder().decode(buf))
      if (rows.length === 0) continue
      months += 1
      for (const row of rows) {
        const lat = Number(row.latitude); const lng = Number(row.longitude); const aqi = Number(row.aqi)
        const key = String(row.sitename ?? `${lat},${lng}`)
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(aqi)) continue
        const acc = sums.get(key)
        if (acc) { acc.total += aqi; acc.n += 1 }
        else sums.set(key, { lat, lng, total: aqi, n: 1 })
      }
    } catch {
      // 某個月抓不到就跳過，不要讓整個來源失敗
    }
  }

  if (sums.size > 0) {
    const stations = [...sums.values()].map((v) => ({ lat: v.lat, lng: v.lng, aqi: Math.round((v.total / v.n) * 10) / 10 }))
    log('aqi', `${stations.length} 個空品測站（最近 ${months} 個月平均，共 ${[...sums.values()].reduce((a, v) => a + v.n, 0)} 筆觀測）`)
    return stations
  }
  log('aqi', '歷史空品資料取不到，退回即時快照 —— 這是當下的值，不是平均')
  const url = `${MOENV_AQI}?api_key=${encodeURIComponent(apiKey)}&limit=1000&format=JSON`
  // 逐時更新，但我們只要一個「大概多乾淨」的值，快取 6 小時就好
  const buffer = await fetchCached(url, `${cacheDir}/moenv-aqi.json`, { maxAgeMs: 6 * 3600_000 })
  // 實測 format=JSON 回的是**頂層陣列**，不是 { records: [...] }。兩種都吃，
  // 因為官方文件寫的是後者，哪天他們改回去也不會壞。
  const rows = toRows(new TextDecoder().decode(buffer))

  const stations: AqiStation[] = []
  for (const row of rows) {
    // 文件寫的是 CamelCase（SiteName / Longitude），實際回的是小寫，且 pm2.5 帶一個真的點
    const lat = Number(row.latitude)
    const lng = Number(row.longitude)
    const aqi = Number(row.aqi)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(aqi)) continue
    stations.push({ lat, lng, aqi })
  }
  log('aqi', `${stations.length} 個空品測站（全台）`)
  return stations
}

/* ------------------------------------------------------------------ */

/** 最近測站。測站太稀疏（大台北 6 個），逐點內插只會製造假精度。 */
export function nearestStation<T extends Point>(point: Point, stations: T[]): T | null {
  let best: T | null = null
  let bestDistance = Infinity
  for (const station of stations) {
    const distance = haversineMeters(point, station)
    if (distance < bestDistance) { bestDistance = distance; best = station }
  }
  return best
}

function num(input: string | number | undefined): number | null {
  const value = Number(input)
  // CWA 用 -99 / -999 當缺值，直接算平均會把整年氣溫拉成負的
  return Number.isFinite(value) && value > -90 ? value : null
}

function mean(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null)
  if (!valid.length) return null
  return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10
}

function sum(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null)
  if (!valid.length) return null
  return Math.round(valid.reduce((a, b) => a + b, 0) * 10) / 10
}

/**
 * 環境部的 JSON 有兩種形狀：頂層陣列（實測 aqx_p_432）與 { records: [...] }（文件寫的、
 * 歷史資料集實際用的）。兩種都吃，哪一邊改了都不會壞。
 */
function toRows(text: string): Record<string, string>[] {
  const json = JSON.parse(text) as Record<string, string>[] | { records?: Record<string, string>[] }
  return Array.isArray(json) ? json : json.records ?? []
}
