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

/** 這是十年才換一版的氣候平均值，不是天氣預報。 */
export async function fetchClimateStations(cacheDir: string, apiKey?: string): Promise<StationValue[]> {
  if (!apiKey) {
    log('climate', '沒有 CWA_API_KEY，略過氣候資料（欄位保持 null）')
    return []
  }
  const url = `${CWA_NORMALS}?Authorization=${encodeURIComponent(apiKey)}&format=JSON`
  const buffer = await fetchCached(url, `${cacheDir}/cwa-normals.json`, { maxAgeMs: 30 * 86400_000 })
  const json = JSON.parse(new TextDecoder().decode(buffer)) as CwaResponse

  // 這個 API 的 records 是 result 的**兄弟**不是子節點，照直覺寫 result.records 會拿到 undefined
  const locations = json.records?.data?.surfaceObs?.location ?? []
  const stations: StationValue[] = []

  for (const location of locations) {
    const lat = Number(location.station?.StationLatitude)
    const lng = Number(location.station?.StationLongitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    // 只留北台灣的測站，其他縣市的對這個 app 沒有用
    if (lat < 24.5 || lat > 25.6 || lng < 121 || lng > 122.2) continue

    const byElement = new Map<string, MonthlyEntry[]>()
    for (const stat of location.stationObsStatistics ?? []) {
      const name = stat.AirTemperature ? 'AirTemperature'
        : stat.Precipitation ? 'Precipitation'
          : stat.RelativeHumidity ? 'RelativeHumidity'
            : stat.SunshineDuration ? 'SunshineDuration' : null
      if (!name) continue
      const monthly = (stat.AirTemperature ?? stat.Precipitation ?? stat.RelativeHumidity ?? stat.SunshineDuration)?.monthly
      if (monthly) byElement.set(name, monthly)
    }

    const temps = byElement.get('AirTemperature') ?? []
    const rain = byElement.get('Precipitation') ?? []
    const humid = byElement.get('RelativeHumidity') ?? []
    const sun = byElement.get('SunshineDuration') ?? []

    stations.push({
      lat,
      lng,
      annualTemp: mean(temps.map((m) => num(m.Mean))),
      // 7-8 月與 1-2 月，用月份索引而不是找極值 —— 極值會挑到單一異常月。
      summerTemp: mean([temps[6], temps[7]].map((m) => num(m?.Mean))),
      winterTemp: mean([temps[0], temps[1]].map((m) => num(m?.Mean))),
      rainDays: sum(rain.map((m) => num(m.GE01Days))),
      humidity: mean(humid.map((m) => num(m.Mean))),
      sunHours: sum(sun.map((m) => num(m.Total))),
    })
  }

  log('climate', `${stations.length} 個北台灣氣候測站（1991-2020 平均值）`)
  return stations
}

interface MonthlyEntry { Mean?: string | number; GE01Days?: string | number; Total?: string | number }
interface ElementBlock { monthly?: MonthlyEntry[] }
interface CwaResponse {
  records?: {
    data?: {
      surfaceObs?: {
        location?: {
          station?: { StationLatitude?: string | number; StationLongitude?: string | number }
          stationObsStatistics?: {
            AirTemperature?: ElementBlock
            Precipitation?: ElementBlock
            RelativeHumidity?: ElementBlock
            SunshineDuration?: ElementBlock
          }[]
        }[]
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 環境部 空氣品質                                                      */
/* ------------------------------------------------------------------ */

const MOENV_AQI = 'https://data.moenv.gov.tw/api/v2/aqx_p_432'

export interface AqiStation extends Point { aqi: number }

export async function fetchAqiStations(cacheDir: string, apiKey?: string): Promise<AqiStation[]> {
  if (!apiKey) {
    log('aqi', '沒有 MOENV_API_KEY，略過空品資料（欄位保持 null）')
    return []
  }
  const url = `${MOENV_AQI}?api_key=${encodeURIComponent(apiKey)}&limit=1000&format=JSON`
  // 逐時更新，但我們只要一個「大概多乾淨」的值，快取 6 小時就好
  const buffer = await fetchCached(url, `${cacheDir}/moenv-aqi.json`, { maxAgeMs: 6 * 3600_000 })
  const json = JSON.parse(new TextDecoder().decode(buffer)) as { records?: Record<string, string>[] }

  const stations: AqiStation[] = []
  for (const row of json.records ?? []) {
    // 文件寫的是 CamelCase（SiteName / Longitude），實際回的是小寫，且 pm2.5 帶一個真的點
    const lat = Number(row.latitude)
    const lng = Number(row.longitude)
    const aqi = Number(row.aqi)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(aqi)) continue
    if (lat < 24.5 || lat > 25.6 || lng < 121 || lng > 122.2) continue
    stations.push({ lat, lng, aqi })
  }
  log('aqi', `${stations.length} 個北台灣空品測站`)
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
