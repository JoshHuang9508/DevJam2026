/**
 * 政府開放資料共用的解析工具。
 *
 * 這裡每一個函式都對應一個實際會咬人的地方，不是為了抽象而抽象 ——
 * 民國年、全形數字、中文樓層、Big5、平方公尺與坪，四個資料源就有四種寫法。
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

/** 平方公尺 → 坪 */
export const M2_PER_PING = 3.305785
export function m2ToPing(m2: number): number {
  return m2 / M2_PER_PING
}

/**
 * 民國年月日（零填補到 7 碼）→ Date。
 * `1140203` = 2025-02-03、`0690126` = 1980-01-26。
 * 注意不能用 slice(0,3)：民國 100 年以前是 3 碼但含前導零，切法會錯開一位。
 */
export function rocDateToISO(input: string | null | undefined): string | null {
  const raw = String(input ?? '').trim()
  if (!/^\d{6,7}$/.test(raw)) return null
  const year = Number(raw.slice(0, raw.length - 4)) + 1911
  const month = Number(raw.slice(-4, -2))
  const day = Number(raw.slice(-2))
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 民國日期字串 → 距今的年數（屋齡）。無法解析回 null。 */
export function rocDateToAgeYears(input: string | null | undefined, now = new Date()): number | null {
  const iso = rocDateToISO(input)
  if (!iso) return null
  const years = (now.getTime() - new Date(iso).getTime()) / (365.2425 * 24 * 3600 * 1000)
  return years < 0 ? null : Math.round(years * 10) / 10
}

/**
 * 地址正規化。實價登錄的門牌混用全形數字（`１巷３弄９號`），
 * 不轉半形的話 geocoding 與字串比對會全部落空。
 */
export function normalizeAddress(input: string): string {
  return input.normalize('NFKC').replace(/\s+/g, '').trim()
}

/** `臺北市內湖區內湖路一段１巷３弄９號五樓` → 去掉末端的樓層，geocoder 才吃得下。 */
export function stripFloorSuffix(address: string): string {
  return normalizeAddress(address)
    .replace(/([\d一二三四五六七八九十百]+樓(之\d+)?|地下[\d一二三四五六七八九十]*層?|頂樓加蓋)$/u, '')
    .replace(/[,，、]$/, '')
}

const CJK_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

/**
 * 中文樓層 → 整數。`五層` → 5、`十九層` → 19、`地下一層` → -1。
 * 實價登錄的 移轉層次／總樓層數 是中文，新北的 API 有時候又給 `018` 字串，兩種都要吃。
 */
export function parseFloor(input: string | null | undefined): number | null {
  const raw = normalizeAddress(String(input ?? '')).replace(/層|樓/g, '')
  if (!raw) return null
  if (/^-?\d+$/.test(raw)) return Number(raw)

  const basement = raw.startsWith('地下')
  const body = basement ? raw.slice(2) : raw
  const value = parseCjkNumber(body)
  if (value === null) return null
  return basement ? -value : value
}

function parseCjkNumber(input: string): number | null {
  if (!input) return null
  // 全字串一次比對，遇到不認識的字（「全」「見其他登記事項」等）就放棄而不是硬湊。
  if (!/^[零一二兩三四五六七八九十百]+$/u.test(input)) return null

  let total = 0
  let section = 0
  let current = 0
  for (const char of input) {
    if (char === '百') {
      section += (current || 1) * 100
      current = 0
    } else if (char === '十') {
      section += (current || 1) * 10
      current = 0
    } else {
      current = CJK_DIGITS[char] ?? 0
    }
  }
  total += section + current
  return total || null
}

/**
 * RFC4180 CSV 解析。刻意不加相依套件 —— 實價登錄的 備註 欄含逗號與引號，
 * 用 split(',') 會把一列切爛，但整套 csv-parse 又只是為了這一件事。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1 } else quoted = false
      } else field += char
      continue
    }
    if (char === '"') { quoted = true; continue }
    if (char === ',') { row.push(field); field = ''; continue }
    if (char === '\r') continue
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += char
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

/**
 * 實價登錄的 CSV 有**兩列**表頭：第一列中文、第二列英文，資料從第三列開始。
 * 直接讀第一列當 header 的話，英文那一列會變成一筆資料。
 */
export function parseLvrCsv(text: string): Record<string, string>[] {
  const rows = parseCsv(stripBom(text)).filter((r) => r.some((cell) => cell.trim() !== ''))
  if (rows.length < 3) return []
  const header = rows[0]
  return rows.slice(2).map((row) => {
    const record: Record<string, string> = {}
    header.forEach((key, index) => { record[key.trim()] = (row[index] ?? '').trim() })
    return record
  })
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** 政府資料有 UTF-8 也有 Big5（例如臺北市住宅竊盜點位），解碼方式不能寫死。 */
export function decode(buffer: ArrayBuffer, encoding: 'utf-8' | 'big5' = 'utf-8'): string {
  return new TextDecoder(encoding).decode(buffer)
}

/** 兩點間的大圓距離（公尺）。 */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * TWD97 TM2 (EPSG:3826) → WGS84。NCDR 的淹水災點是 TM2 公尺，不轉的話座標會落在非洲外海。
 * 用標準的 Transverse Mercator 反算，誤差在公尺等級，對「附近有沒有淹過水」這種用途夠了。
 */
export function twd97ToWgs84(x: number, y: number): { lat: number; lng: number } {
  const a = 6378137.0
  const f = 1 / 298.257222101 // GRS80
  const k0 = 0.9999
  const lng0 = (121 * Math.PI) / 180
  const dx = 250000

  const b = a * (1 - f)
  const e2 = (a * a - b * b) / (a * a)
  const e12 = (a * a - b * b) / (b * b)
  const e = (1 - b / a) / (1 + b / a)

  const M = y / k0
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256))
  const p1 = mu + ((3 * e) / 2 - (27 * e ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e * e) / 16 - (55 * e ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e ** 4) / 512) * Math.sin(8 * mu)

  const C1 = e12 * Math.cos(p1) ** 2
  const T1 = Math.tan(p1) ** 2
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2)
  const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5
  const D = (x - dx) / (N1 * k0)

  const lat = p1 - ((N1 * Math.tan(p1)) / R1) * ((D * D) / 2
    - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * e12) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * e12 - 3 * C1 * C1) * D ** 6) / 720)
  const lng = lng0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6
    + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * e12 + 24 * T1 * T1) * D ** 5) / 120) / Math.cos(p1)

  return { lat: (lat * 180) / Math.PI, lng: (lng * 180) / Math.PI }
}

/** 點是否落在多邊形內（ray casting）。ring 為 [lng, lat] 陣列，符合 GeoJSON 慣例。 */
export function pointInRing(point: { lat: number; lng: number }, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects = yi > point.lat !== yj > point.lat
      && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

/* ------------------------------------------------------------------ */
/* 下載快取                                                            */
/* ------------------------------------------------------------------ */

/**
 * 抓下來的原始檔存在 data/cache/（有 gitignore）。
 * cron 每天跑一次，但實價登錄一個月只更新三次、氣候平均值十年才換一版 ——
 * 沒有快取的話每天都在重抓幾百 MB，而且對方是政府的免費服務。
 */
export async function fetchCached(
  url: string,
  cachePath: string,
  options: { maxAgeMs?: number; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<ArrayBuffer> {
  const maxAge = options.maxAgeMs ?? 12 * 3600 * 1000
  if (existsSync(cachePath) && Date.now() - statSync(cachePath).mtimeMs < maxAge) {
    return toArrayBuffer(readFileSync(cachePath))
  }

  const response = await fetch(url, {
    headers: options.headers,
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} — ${url}`)
  const buffer = await response.arrayBuffer()

  mkdirSync(dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, Buffer.from(buffer))
  return buffer
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

export function log(scope: string, message: string): void {
  console.log(`[${new Date().toISOString()}] ${scope}: ${message}`)
}
