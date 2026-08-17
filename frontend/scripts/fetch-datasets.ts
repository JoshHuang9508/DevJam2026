/**
 * 真實資料抓取 pipeline。設計成可以被 cron 直接呼叫。
 *
 *   pnpm fetch:data                      # 本期實價登錄 + POI + 捷運 + 災害
 *   pnpm fetch:data --seasons=115S2,115S1  # 另外回補季檔
 *   pnpm fetch:data --only=lvr,poi       # 只跑某幾個來源
 *   pnpm fetch:data --keep-seed          # 不清掉既有的示範資料
 *
 * 資料來源與授權：
 *   實價登錄       內政部地政司       政府資料開放授權條款 v1     免金鑰
 *   捷運出入口     臺北市資料大平臺   政府資料開放授權條款 v1     免金鑰
 *   POI            OpenStreetMap      ODbL 1.0（share-alike）     免金鑰
 *   土壤液化       臺北市政府工務局   政府資料開放授權條款 v1     免金鑰
 *   淹水災點       NCDR               開放                        免金鑰
 *   氣候平均值     中央氣象署         政府資料開放授權條款 v1     需 CWA_API_KEY
 *   空氣品質       環境部             政府資料開放授權條款 v1     需 MOENV_API_KEY
 *   地址定位       Google Geocoding   商用計費                    需 GEOCODING_API_KEY
 *
 * 沒有金鑰的來源會被略過，對應欄位留 null，前端的 fillDataGaps 會補中位數並在
 * dataGaps 標示 —— 這比塞一個假數字進去誠實。
 */
import Database from 'better-sqlite3'
import { CITY_CENTROIDS, DISTRICTS, findDistrict } from '../lib/pipeline/districts'
import {
  Geocoder, GridIndex, fetchFloodPoints, fetchLiquefaction, fetchMrtExits, fetchPoi,
  liquefactionLevel, type PoiIndex, type Point,
} from '../lib/pipeline/sources/geo'
import { fetchLvr, isResidential, type LvrRecord } from '../lib/pipeline/sources/lvr'
import { fetchTransport } from '../lib/pipeline/sources/transport'
import { fetchAqiStations, fetchClimateStations, nearestStation } from '../lib/pipeline/sources/weather'
import { haversineMeters, log } from '../lib/pipeline/util'

const DB_PATH = process.env.DATABASE_PATH ?? './data/app.db'
const CACHE_DIR = process.env.PIPELINE_CACHE_DIR ?? './data/cache'
/**
 * 各縣市的通勤參考終點（市中心／主要車站）。
 *
 * 原本全台一律用臺北車站，對高雄的房子而言「到臺北車站要 280 分鐘」毫無意義，
 * 而且會讓所有非北部物件的通勤分數一律墊底。
 */
const CITY_CBD: Record<string, Point> = {
  臺北市: { lat: 25.0478, lng: 121.5170 }, // 臺北車站
  新北市: { lat: 25.0478, lng: 121.5170 }, // 通勤圈仍以臺北車站為主
  基隆市: { lat: 25.1319, lng: 121.7396 },
  桃園市: { lat: 24.9892, lng: 121.3140 },
  新竹市: { lat: 24.8016, lng: 120.9715 },
  新竹縣: { lat: 24.8016, lng: 120.9715 },
  苗栗縣: { lat: 24.5654, lng: 120.8214 },
  臺中市: { lat: 24.1369, lng: 120.6869 },
  彰化縣: { lat: 24.0813, lng: 120.5385 },
  南投縣: { lat: 23.9099, lng: 120.6858 },
  雲林縣: { lat: 23.7092, lng: 120.4313 },
  嘉義市: { lat: 23.4791, lng: 120.4416 },
  嘉義縣: { lat: 23.4791, lng: 120.4416 },
  臺南市: { lat: 22.9970, lng: 120.2126 },
  高雄市: { lat: 22.6396, lng: 120.3021 },
  屏東縣: { lat: 22.6689, lng: 120.4874 },
  宜蘭縣: { lat: 24.7546, lng: 121.7581 },
  花蓮縣: { lat: 23.9930, lng: 121.6011 },
  臺東縣: { lat: 22.7972, lng: 121.1236 },
  澎湖縣: { lat: 23.5655, lng: 119.5664 },
  金門縣: { lat: 24.4321, lng: 118.3171 },
  連江縣: { lat: 26.1608, lng: 119.9509 },
}

interface Options {
  only: Set<string>
  seasons: string[]
  keepSeed: boolean
}

function parseArgs(argv: string[]): Options {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
  const only = get('only')
  return {
    only: new Set((only ? only.split(',') : []).map((s) => s.trim()).filter(Boolean)),
    seasons: (get('seasons') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    keepSeed: argv.includes('--keep-seed'),
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const wants = (name: string) => options.only.size === 0 || options.only.has(name)
  const started = Date.now()

  /* -------- 1. 物件本體 ------------------------------------------- */
  log('pipeline', `開始，DB=${DB_PATH} cache=${CACHE_DIR}`)
  const raw = await fetchLvr({ cacheDir: CACHE_DIR, seasons: options.seasons })
  const records = raw.filter(isResidential)
  log('lvr', `${raw.length} 筆成交，篩選後 ${records.length} 筆可當住宅物件`)
  if (records.length === 0) throw new Error('實價登錄一筆都沒解析出來，不覆寫既有資料')

  /* -------- 2. 定位（兩段式）--------------------------------------- */
  // 第一段盡量精確定位，第二段才處理失敗的。
  // 不能在第一段就退回「行政區重心」—— 全台 368 個區不可能硬寫成表，
  // 之前只有 30 個區的版本會讓查不到的區全部退到清單第一筆（中正區），
  // 於是桃園台中高雄的物件會整批落在台北市中心。
  const geocoder = new Geocoder(
    `${CACHE_DIR}/geocode.json`,
    process.env.GEOCODING_API_KEY,
    Number(process.env.GEOCODE_BUDGET) || Number.POSITIVE_INFINITY,
  )

  type Located = LvrRecord & { lat: number; lng: number; approximate: boolean }
  const located: Located[] = []
  const pending: LvrRecord[] = []

  for (const [index, record] of records.entries()) {
    const point = await geocoder.lookup(record.address)
    if (point) located.push({ ...record, ...point, approximate: false })
    else pending.push(record)
    if ((index + 1) % 1000 === 0) log('geocode', `${index + 1}/${records.length}（精確 ${located.length}）`)
  }
  geocoder.save()

  // 用已精確定位的物件反推每一區、每一縣市的重心。比任何硬寫的表都準，
  // 而且自動涵蓋全台 —— 有資料的地方就有重心。
  const districtCentroids = meanByKey(located, (r) => `${r.city}|${r.district}`)
  const cityCentroids = meanByKey(located, (r) => r.city)

  for (const record of pending) {
    const centroid = districtCentroids.get(`${record.city}|${record.district}`)
      ?? cityCentroids.get(record.city)
      ?? findDistrict(record.city, record.district)
      ?? CITY_CENTROIDS[record.city]
    if (!centroid) {
      log('geocode', `${record.city}${record.district} 沒有任何可用重心，略過這筆`)
      continue
    }
    located.push({ ...record, ...jitter(centroid, record.address), approximate: true })
  }

  const stats = geocoder.stats
  log('geocode', `快取命中 ${stats.cached}、新查 ${stats.geocoded}、查無 ${stats.failed}、`
    + `近似座標 ${located.filter((r) => r.approximate).length}/${located.length} 筆`
    + (geocoder.budgetExhausted ? `（已達 GEOCODE_BUDGET 上限 ${stats.budgetSpent}）` : ''))

  /* -------- 3. 環境特徵 -------------------------------------------- */
  const poi: PoiIndex = wants('poi')
    ? await fetchPoi(CACHE_DIR)
    : { convenience: [], supermarket: [], school: [], hospital: [], park: [], restaurant: [] }
  // 站點與線形。OSM 一次涵蓋全台所有系統（北中南桃捷運、台鐵、高鐵），
  // data.taipei 只有北捷，非雙北的物件會全部拿不到軌道距離。
  const transport = wants('mrt')
    ? await fetchTransport(CACHE_DIR).catch(fail('交通圖資'))
    : []
  const t = Array.isArray(transport)
    ? { trainStations: [], metroStations: [], busStops: [], mainRoadPoints: [], railwayPoints: [] }
    : transport
  // data.taipei 的北捷出入口比 OSM 精確（出入口而非站中心），兩者合併
  const taipeiExits = wants('mrt') ? await fetchMrtExits(CACHE_DIR).catch(fail('北捷出入口')) : []
  const metroPoints = [...t.metroStations, ...taipeiExits]
  const liquefaction = wants('hazard') ? await fetchLiquefaction(CACHE_DIR).catch(fail('液化')) : []
  const flood = wants('hazard') ? await fetchFloodPoints(CACHE_DIR).catch(fail('淹水')) : []
  const climate = wants('climate') ? await fetchClimateStations(CACHE_DIR, process.env.CWA_API_KEY).catch(fail('氣候')) : []
  const aqi = wants('aqi') ? await fetchAqiStations(CACHE_DIR, process.env.MOENV_API_KEY).catch(fail('空品')) : []

  // 每一類 POI 各自的覆蓋範圍。用實際抓到的點推，而不是相信查詢字串寫了什麼。
  const coverage = {
    convenience: bboxOf(poi.convenience), supermarket: bboxOf(poi.supermarket),
    school: bboxOf(poi.school), hospital: bboxOf(poi.hospital),
    park: bboxOf(poi.park), restaurant: bboxOf(poi.restaurant),
  }

  const grids = {
    convenience: new GridIndex(poi.convenience),
    supermarket: new GridIndex(poi.supermarket),
    school: new GridIndex(poi.school),
    hospital: new GridIndex(poi.hospital),
    park: new GridIndex(poi.park),
    restaurant: new GridIndex(poi.restaurant),
    metro: new GridIndex(metroPoints),
    train: new GridIndex(t.trainStations),
    bus: new GridIndex(t.busStops),
    mainRoad: new GridIndex(t.mainRoadPoints),
    railway: new GridIndex(t.railwayPoints),
    flood: new GridIndex(flood),
  }

  /* -------- 4. 同區同型態的單價百分位 ------------------------------ */
  // pricePercentile 是「這間相對於同區同型態行情貴不貴」，必須在同一群體內比，
  // 拿全體算的話新北的便宜物件會永遠贏過台北的合理價物件。
  const buckets = new Map<string, number[]>()
  const bucketKey = (r: LvrRecord) => `${r.mode}|${r.city}|${r.district}|${r.buildingType}`
  for (const record of located) {
    const key = bucketKey(record)
    const list = buckets.get(key)
    if (list) list.push(record.unitPrice)
    else buckets.set(key, [record.unitPrice])
  }
  for (const list of buckets.values()) list.sort((a, b) => a - b)

  /* -------- 5. 寫入 ------------------------------------------------ */
  const db = new Database(DB_PATH)
  // 刻意不開 WAL：這個檔案會被 web 容器以唯讀 bind mount 掛進去，
  // 而 WAL 的讀取端需要能寫 -shm 檔，唯讀掛載下會直接開不起來。

  const now = Date.now()
  const insertListing = db.prepare(`
    INSERT OR REPLACE INTO listings (
      id, source, source_id, mode, url, title, scraped_at, city, district, address,
      lat, lng, price, unit_price, area, layout, rooms, floor, total_floor, age,
      building_type, has_elevator, has_parking
    ) VALUES (
      @id, @source, @sourceId, @mode, @url, @title, @scrapedAt, @city, @district, @address,
      @lat, @lng, @price, @unitPrice, @area, @layout, @rooms, @floor, @totalFloor, @age,
      @buildingType, @hasElevator, @hasParking
    )`)

  const insertFeatures = db.prepare(`
    INSERT OR REPLACE INTO listing_features (
      listing_id, annual_temp, summer_temp, winter_temp, rain_days, humidity, sun_hours, aqi_mean,
      poi_convenience_500, poi_convenience_1k, poi_supermarket_500, poi_supermarket_1k,
      poi_school_500, poi_school_1k, poi_hospital_500, poi_hospital_1k,
      poi_park_500, poi_park_1k, poi_restaurant_500, poi_restaurant_1k,
      dist_to_metro, dist_to_train, dist_to_bus, commute_to_cbd_min,
      district_median_unit_price, price_percentile, dist_to_main_road, dist_to_rail,
      flood_incidents_500, liquefaction_level,
      fs_entry_window_aligned, fs_entry_screen, fs_stove_visible_from_door, fs_toilet_facing_door,
      fs_beam_over_bed, fs_living_room_depth_m, fs_daylight_blocked, fs_road_rush
    ) VALUES (
      @listingId, @annualTemp, @summerTemp, @winterTemp, @rainDays, @humidity, @sunHours, @aqiMean,
      @c5, @c1k, @s5, @s1k, @sc5, @sc1k, @h5, @h1k, @p5, @p1k, @r5, @r1k,
      @distToMetro, @distToTrain, @distToBus, @commuteToCbdMin,
      @districtMedianUnitPrice, @pricePercentile, @distToMainRoad, @distToRail,
      @floodIncidents500, @liquefactionLevel,
      @fsEntryWindowAligned, @fsEntryScreen, @fsStoveVisibleFromDoor, @fsToiletFacingDoor,
      @fsBeamOverBed, @fsLivingRoomDepthM, @fsDaylightBlocked, @fsRoadRush
    )`)

  const write = db.transaction(() => {
    if (!options.keepSeed) {
      // 先刪 features 再刪 listings —— 反過來會撞到外鍵
      db.prepare('DELETE FROM listing_features').run()
      db.prepare('DELETE FROM listings').run()
    }

    // districts 表用實際資料算出來的重心，涵蓋全台有成交紀錄的每一個區；
    // DISTRICTS 那 30 筆只是雙北的備援。
    const districtRows = meanByKey(located, (r) => `${r.city}|${r.district}`)
    const insertDistrict = db.prepare(`INSERT OR REPLACE INTO districts
      (id, city, name, centroid_lat, centroid_lng, boundary) VALUES (?, ?, ?, ?, ?, NULL)`)
    for (const [key, point] of districtRows) {
      const [city, name] = key.split('|')
      insertDistrict.run(`${city}-${name}`, city, name, point.lat, point.lng)
    }
    for (const district of DISTRICTS) {
      if (districtRows.has(`${district.city}|${district.name}`)) continue
      insertDistrict.run(`${district.city}-${district.name}`, district.city, district.name, district.lat, district.lng)
    }

    for (const record of located) {
      const id = `lvr-${record.mode}-${record.serial}`
      const point = { lat: record.lat, lng: record.lng }
      const bucket = buckets.get(bucketKey(record)) ?? []

      insertListing.run({
        id,
        source: 'moi-lvr',
        sourceId: record.serial,
        mode: record.mode,
        // 實價登錄沒有物件頁，指回內政部的查詢系統是唯一誠實的連結
        url: 'https://plvr.land.moi.gov.tw/DownloadOpenData',
        title: `${record.district}${record.buildingType} ${record.area}坪`,
        scrapedAt: now,
        city: record.city,
        district: record.district,
        address: record.address,
        lat: record.lat,
        lng: record.lng,
        price: record.price,
        unitPrice: record.unitPrice,
        area: record.area,
        layout: record.layout,
        rooms: record.rooms,
        floor: record.floor,
        totalFloor: record.totalFloor,
        age: record.age,
        buildingType: record.buildingType,
        hasElevator: record.hasElevator ? 1 : 0,
        hasParking: record.hasParking ? 1 : 0,
      })

      const climateStation = nearestStation(point, climate)
      const aqiStation = nearestStation(point, aqi)
      // 單位一律**公尺**。lib/scoring/dimensions.ts 的 RAIL_WALKABLE_M 等常數都是公尺，
      // 之前這裡寫公里，location 維度算出來的分數對每一筆都趨近 1，等於整個維度沒作用。
      const distToMetro = metroPoints.length ? grids.metro.nearestMeters(point, 8000) : null
      const distToTrain = t.trainStations.length ? grids.train.nearestMeters(point, 15000) : null
      const distToBus = t.busStops.length ? grids.bus.nearestMeters(point, 3000) : null
      const distToMainRoad = t.mainRoadPoints.length ? grids.mainRoad.nearestMeters(point, 5000) : null
      const distToRail = t.railwayPoints.length ? grids.railway.nearestMeters(point, 5000) : null
      const floodNearby = flood.length ? grids.flood.countWithin(point, 500) : 0
      const liquefaction3 = liquefactionLevel(point, liquefaction)

      insertFeatures.run({
        listingId: id,
        annualTemp: climateStation?.annualTemp ?? null,
        summerTemp: climateStation?.summerTemp ?? null,
        winterTemp: climateStation?.winterTemp ?? null,
        rainDays: climateStation?.rainDays ?? null,
        humidity: climateStation?.humidity ?? null,
        sunHours: climateStation?.sunHours ?? null,
        aqiMean: aqiStation?.aqi ?? null,

        c5: count(grids.convenience, point, 500, coverage.convenience),
        c1k: count(grids.convenience, point, 1000, coverage.convenience),
        s5: count(grids.supermarket, point, 500, coverage.supermarket),
        s1k: count(grids.supermarket, point, 1000, coverage.supermarket),
        sc5: count(grids.school, point, 500, coverage.school),
        sc1k: count(grids.school, point, 1000, coverage.school),
        h5: count(grids.hospital, point, 500, coverage.hospital),
        h1k: count(grids.hospital, point, 1000, coverage.hospital),
        p5: count(grids.park, point, 500, coverage.park),
        p1k: count(grids.park, point, 1000, coverage.park),
        r5: count(grids.restaurant, point, 500, coverage.restaurant),
        r1k: count(grids.restaurant, point, 1000, coverage.restaurant),

        distToMetro: distToMetro === null ? null : Math.round(distToMetro),
        distToTrain: distToTrain === null ? null : Math.round(distToTrain),
        distToBus: distToBus === null ? null : Math.round(distToBus),
        commuteToCbdMin: estimateCommuteMinutes(point, record.city, distToMetro, distToTrain),

        districtMedianUnitPrice: median(bucket),
        pricePercentile: percentile(bucket, record.unitPrice),

        distToMainRoad: distToMainRoad === null ? null : Math.round(distToMainRoad),
        distToRail: distToRail === null ? null : Math.round(distToRail),

        // ⚠ 風水證據是**擲骰產生的假資料**，見 fengshuiEvidence 的說明。
        ...fengshuiEvidence(id, record),

        // null 與 0 的差別很重要：null＝沒查（沒抓災點資料），0＝查過但附近沒有。
        // 前者會被 fillDataGaps 補中位數並標進 dataGaps，後者是真的安全。
        floodIncidents500: flood.length ? floodNearby : null,
        // 土壤液化只有臺北市有圖資，其餘一律 null＝未檢測，不是「無虞」。
        liquefactionLevel: liquefaction3,
      })
    }
  })

  write()
  const counts = db.prepare('SELECT mode, COUNT(*) AS n FROM listings GROUP BY mode').all() as { mode: string; n: number }[]
  db.close()

  log('pipeline', `完成，耗時 ${Math.round((Date.now() - started) / 1000)}s：`
    + counts.map((c) => `${c.mode}=${c.n}`).join(' '))
}

/**
 * ⚠ **風水證據是假的。**
 *
 * 這八個欄位需要判讀格局圖、照片或街景，實價登錄完全沒有這些資訊，短期內也做不出來。
 * 依需求破例用擲骰產生，讓風水維度有東西可以算，而不是整維失效。
 *
 * 用門牌雜湊當種子而不是 Math.random()：同一間房子每次跑 pipeline 都要得到同一組值，
 * 否則每天更新資料後排名會無故跳動，使用者會以為系統壞了。
 *
 * 機率不是均勻亂數，而是依屋齡、樓層、坪數調整過的 —— 老公寓比新大樓更可能有樑壓床、
 * 低樓層更可能採光受阻。這讓假資料至少在統計上像真的，但**它仍然是假的**：
 * 卡片上說某間房子有穿堂煞，不代表它真的有。前端必須標示清楚。
 */
function fengshuiEvidence(id: string, record: LvrRecord): Record<string, number | null> {
  let h = 2166136261
  for (let i = 0; i < id.length; i += 1) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) }
  let cursor = h >>> 0
  const rand = () => {
    // xorshift32：同一個種子必然產生同一串值
    cursor ^= cursor << 13; cursor >>>= 0
    cursor ^= cursor >>> 17
    cursor ^= cursor << 5; cursor >>>= 0
    return cursor / 4294967296
  }
  const flag = (p: number) => (rand() < p ? 1 : 0)

  const old = record.age >= 30
  const lowFloor = record.floor <= 3
  const small = record.area <= 20

  return {
    // 小坪數的開放式格局較容易前後門窗對齊
    fsEntryWindowAligned: flag(small ? 0.30 : 0.18),
    // 有玄關屏風是化解手段，新屋比較常見
    fsEntryScreen: flag(old ? 0.25 : 0.45),
    fsStoveVisibleFromDoor: flag(small ? 0.35 : 0.20),
    fsToiletFacingDoor: flag(0.15),
    // 老屋樑柱外露的比例高
    fsBeamOverBed: flag(old ? 0.35 : 0.18),
    // 明堂縱深（公尺），跟坪數正相關
    fsLivingRoomDepthM: Math.round((2.0 + Math.sqrt(record.area) * 0.35 + rand() * 1.2) * 10) / 10,
    // 低樓層採光受阻的機率高很多
    fsDaylightBlocked: flag(lowFloor ? 0.40 : 0.12),
    fsRoadRush: flag(0.12),
  }
}

/** 依 key 分群取座標平均。用來從已精確定位的物件反推行政區／縣市重心。 */
function meanByKey<T extends Point>(items: T[], key: (item: T) => string): Map<string, Point> {
  const sums = new Map<string, { lat: number; lng: number; n: number }>()
  for (const item of items) {
    const k = key(item)
    const acc = sums.get(k)
    if (acc) { acc.lat += item.lat; acc.lng += item.lng; acc.n += 1 }
    else sums.set(k, { lat: item.lat, lng: item.lng, n: 1 })
  }
  return new Map([...sums].map(([k, v]) => [k, { lat: v.lat / v.n, lng: v.lng / v.n }]))
}

/** 重心 + 依門牌雜湊決定的固定位移（約 ±700m）。同一門牌永遠落在同一點。 */
function jitter(centroid: Point, address: string): Point {
  let hash = 2166136261
  for (let i = 0; i < address.length; i += 1) {
    hash ^= address.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const a = ((hash >>> 0) % 10000) / 10000
  const b = ((Math.imul(hash, 31) >>> 0) % 10000) / 10000
  return { lat: centroid.lat + (a - 0.5) * 0.012, lng: centroid.lng + (b - 0.5) * 0.012 }
}

/**
 * POI 計數。**範圍外一律回 null 而不是 0。**
 *
 * 0 的意思是「查過，附近沒有」；null 是「沒查」。兩者在分數上天差地別 ——
 * 0 會讓那筆在生活機能維度拿最低分，null 則由 fillDataGaps 補中位數並標進 dataGaps。
 * 之前 POI 只涵蓋雙北卻對全台回 0，高雄台中的房子就全部被判定成沒有生活機能。
 */
function count(grid: GridIndex, point: Point, radius: number, coverage: Bbox | null): number | null {
  if (!coverage || !inBbox(point, coverage)) return null
  return grid.countWithin(point, radius)
}

interface Bbox { minLat: number; maxLat: number; minLng: number; maxLng: number }

/** 實際抓到的 POI 所涵蓋的範圍。留一點邊，免得邊界上的物件被誤判成沒查過。 */
function bboxOf(points: Point[], padDeg = 0.05): Bbox | null {
  if (points.length === 0) return null
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
  }
  return { minLat: minLat - padDeg, maxLat: maxLat + padDeg, minLng: minLng - padDeg, maxLng: maxLng + padDeg }
}

function inBbox(p: Point, b: Bbox): boolean {
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng
}

/**
 * 到臺北車站的通勤時間估計。沒有接 TDX 的站間旅行時間，所以是個粗估：
 * 走到最近捷運站的步行時間 + 直線距離換算的搭乘時間。標成估計值，不要當真。
 */
function estimateCommuteMinutes(
  point: Point,
  city: string,
  distToMetroMeters: number | null,
  distToTrainMeters: number | null,
): number | null {
  const cbd = CITY_CBD[city]
  if (!cbd) return null
  // 走到最近的軌道站（捷運或台鐵，取近的那個）
  const access = [distToMetroMeters, distToTrainMeters].filter((v): v is number => v !== null)
  if (access.length === 0) return null
  const walkMinutes = Math.min(...access) / 80 // 每分鐘 80 公尺
  const railKm = haversineMeters(point, cbd) / 1000
  return Math.round((walkMinutes + railKm * 2.2 + 4) * 10) / 10
}

function median(sorted: number[]): number | null {
  if (!sorted.length) return null
  const mid = Math.floor(sorted.length / 2)
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return round(value, 3)
}

function percentile(sorted: number[], value: number): number | null {
  if (sorted.length < 2) return null
  let below = 0
  while (below < sorted.length && sorted[below] < value) below += 1
  return round(below / (sorted.length - 1), 4)
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 單一來源掛掉不該讓整條 pipeline 死掉 —— 那個欄位留空就好。 */
function fail(label: string): (error: unknown) => never[] {
  return (error) => {
    log('pipeline', `${label} 來源失敗，該欄位留 null：${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

main().catch((error) => {
  console.error('[pipeline] 失敗', error)
  process.exit(1)
})
