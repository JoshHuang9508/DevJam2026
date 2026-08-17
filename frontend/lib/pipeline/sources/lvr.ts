import { unzipSync } from 'fflate'
import { LVR_CITY_PREFIX } from '../districts'
import {
  fetchCached, log, m2ToPing, normalizeAddress, parseFloor, parseLvrCsv,
  rocDateToAgeYears, rocDateToISO,
} from '../util'

/**
 * 內政部不動產成交案件實際資訊（實價登錄）。
 *
 * 免金鑰、免註冊、無流量限制（內政部 2015 公告）。本期檔每月 1/11/21 更新，
 * 涵蓋滾動的近三個月；季檔可回溯到 101S3（民國 101 年 8 月，實價登錄上路）。
 *
 * 這是**成交紀錄**不是**在售物件**。台灣沒有合法的大量在售物件來源 ——
 * 591 的服務條款明文禁止爬取，而且有實際判決（591 訴豬豬快租，公平交易法 + 侵權）。
 * 所以這裡誠實地把成交案件當成物件池，前端也必須標示清楚。
 */

const BASE = 'https://plvr.land.moi.gov.tw'
const CURRENT = {
  sale: `${BASE}/opendata/lvr_landAcsv.zip`,
  rent: `${BASE}/opendata/lvr_landCcsv.zip`,
} as const

export interface LvrRecord {
  mode: 'sale' | 'rent'
  serial: string
  city: string
  district: string
  address: string
  /** sale: 萬元總價 / rent: 元月租 */
  price: number
  /** sale: 萬元每坪 / rent: 元每坪 */
  unitPrice: number
  /** 坪 */
  area: number
  layout: string
  rooms: number
  floor: number
  totalFloor: number
  age: number
  buildingType: string
  hasElevator: boolean
  hasParking: boolean
  transactedAt: string
  note: string
}

export async function fetchLvr(options: {
  cacheDir: string
  /** 民國季別，例如 ["115S2","115S1"]。空陣列則只抓本期檔。 */
  seasons?: string[]
  maxAgeMs?: number
}): Promise<LvrRecord[]> {
  const out: LvrRecord[] = []
  const seasons = options.seasons ?? []

  for (const mode of ['sale', 'rent'] as const) {
    const buffer = await fetchCached(CURRENT[mode], `${options.cacheDir}/lvr-current-${mode}.zip`, {
      maxAgeMs: options.maxAgeMs ?? 12 * 3600 * 1000,
    })
    out.push(...parseZip(buffer, mode))
  }

  for (const season of seasons) {
    const url = `${BASE}/DownloadSeason?season=${season}&type=zip&fileName=lvr_landcsv.zip`
    let buffer: ArrayBuffer
    try {
      // 季檔幾乎不會變，快取放到 30 天
      buffer = await fetchCached(url, `${options.cacheDir}/lvr-${season}.zip`, { maxAgeMs: 30 * 86400_000 })
    } catch (error) {
      log('lvr', `季檔 ${season} 抓取失敗，略過：${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    // 尚未發布的季別回的是 200 + 441 bytes 的空 zip，不是 404 —— 只能靠大小判斷。
    if (buffer.byteLength < 2000) {
      log('lvr', `季檔 ${season} 尚未發布（${buffer.byteLength} bytes），略過`)
      continue
    }
    out.push(...parseZip(buffer, 'sale'), ...parseZip(buffer, 'rent'))
  }

  // 同一筆成交會同時出現在本期檔與季檔裡，用 編號 去重。
  const seen = new Set<string>()
  return out.filter((record) => {
    const key = `${record.mode}:${record.serial}`
    if (!record.serial || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function parseZip(buffer: ArrayBuffer, mode: 'sale' | 'rent'): LvrRecord[] {
  const suffix = mode === 'sale' ? 'a' : 'c'
  const files = unzipSync(new Uint8Array(buffer))
  const records: LvrRecord[] = []
  const decoder = new TextDecoder('utf-8')

  for (const [name, bytes] of Object.entries(files)) {
    // `a_lvr_land_a.csv` = 臺北市買賣主檔。_build/_land/_park 是明細檔，這裡不吃。
    const match = /^([a-z])_lvr_land_([abc])\.csv$/.exec(name)
    if (!match) continue
    const city = LVR_CITY_PREFIX[match[1]]
    if (!city || match[2] !== suffix) continue

    for (const row of parseLvrCsv(decoder.decode(bytes))) {
      const record = toRecord(row, city, mode)
      if (record) records.push(record)
    }
  }
  return records
}

function toRecord(row: Record<string, string>, city: string, mode: 'sale' | 'rent'): LvrRecord | null {
  const district = row['鄉鎮市區']?.trim()
  const address = normalizeAddress(row['土地位置建物門牌'] ?? '')
  if (!district || !address) return null

  // 買賣與租賃的欄位名不同：總價元/總額元、交易年月日/租賃年月日、
  // 建物移轉總面積/建物總面積。同一支 parser 要吃兩種表頭。
  const totalRaw = Number(mode === 'sale' ? row['總價元'] : row['總額元'])
  const areaM2Raw = Number(mode === 'sale' ? row['建物移轉總面積平方公尺'] : row['建物總面積平方公尺'])
  if (!Number.isFinite(totalRaw) || totalRaw <= 0) return null
  if (!Number.isFinite(areaM2Raw) || areaM2Raw <= 0) return null

  // 總價含車位。不扣掉的話有車位的物件單價會被系統性高估。
  const parkPrice = Number(mode === 'sale' ? row['車位總價元'] : row['車位總額元']) || 0
  const parkArea = Number(mode === 'sale' ? row['車位移轉總面積平方公尺'] : row['車位面積平方公尺']) || 0
  const hasParking = parkPrice > 0 || parkArea > 0

  const netTotal = Math.max(totalRaw - parkPrice, 0)
  const netAreaPing = m2ToPing(Math.max(areaM2Raw - parkArea, 0))
  if (netTotal <= 0 || netAreaPing <= 0.5) return null

  // 前端的單位慣例：買賣是萬元總價與萬元每坪，租賃是元月租與元每坪。
  const price = mode === 'sale' ? netTotal / 10_000 : netTotal
  const unitPrice = price / netAreaPing

  const rooms = Number(row['建物現況格局-房']) || 0
  const halls = Number(row['建物現況格局-廳']) || 0
  const baths = Number(row['建物現況格局-衛']) || 0

  const floor = parseFloor(mode === 'sale' ? row['移轉層次'] : row['租賃層次'])
  const totalFloor = parseFloor(row['總樓層數'])
  const buildingType = (row['建物型態'] || '').trim() || '其他'
  const transactedAt = rocDateToISO(mode === 'sale' ? row['交易年月日'] : row['租賃年月日'])
  const age = rocDateToAgeYears(row['建築完成年月'])

  return {
    mode,
    serial: (row['編號'] || '').trim(),
    city,
    district,
    address,
    price: round(price, 2),
    unitPrice: round(unitPrice, 3),
    area: round(netAreaPing, 2),
    // rooms=0 是「格局未登錄」，不是套房 —— 把 114 坪的物件標成「開放式」會誤導。
    // 只有小坪數才敢當成真的開放式套房。
    layout: rooms > 0 ? `${rooms}房${halls}廳${baths}衛` : (netAreaPing <= 15 ? '開放式' : '格局未登錄'),
    rooms,
    floor: floor ?? 1,
    totalFloor: totalFloor ?? Math.max(floor ?? 1, 1),
    // 屋齡真正的來源是 _build 明細檔，但主檔的 建築完成年月 已足夠且不必做 編號 join。
    // 兩者都缺（預售屋常見）就給 0，並在 dataGaps 反映。
    age: age ?? 0,
    buildingType,
    // 買賣主檔有「電梯」欄；租賃是「有無電梯」。都沒有就靠建物型態推 —— 公寓沒電梯、大樓有。
    hasElevator: parseYesNo(row['電梯'] ?? row['有無電梯']) ?? !/公寓|透天|華廈\(10層含以下有電梯\)/.test(buildingType),
    hasParking,
    transactedAt: transactedAt ?? '',
    note: (row['備註'] || '').trim(),
  }
}

function parseYesNo(input: string | undefined): boolean | null {
  const raw = (input ?? '').trim()
  if (raw === '有') return true
  if (raw === '無') return false
  return null
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * 明顯不能當成住宅物件的成交紀錄。
 *
 * 備註欄不是裝飾 —— 親友交易、含增建、解約、急買急賣都寫在那裡，
 * 不過濾的話這些會變成離群值把同區的價格分布拉歪。
 */
export function isResidential(record: LvrRecord): boolean {
  if (/車位|土地|農地|廠辦|辦公|店面|工廠|倉庫/.test(record.buildingType)) return false
  if (/親友|自行|債務|解約|瑕疵|急買|急賣|畸零/.test(record.note)) return false
  if (record.area < 3 || record.area > 200) return false
  // 房數超過 10 的不是住家，是整棟出租、宿舍或登錄錯誤（實測有 rooms=300 的紀錄）
  if (record.rooms > 10) return false
  if (record.mode === 'sale' && (record.price < 100 || record.price > 30_000)) return false
  if (record.mode === 'rent' && (record.price < 3_000 || record.price > 500_000)) return false
  return true
}
