/**
 * 產生確定性的示範資料（台北市 + 新北市）。
 * 氣候值取自中央氣象署測站氣候平均的近似值，POI 與距離為模擬值。
 * 真實抓取與 enrich 見計畫 B。
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { estimateCommuteMinutes } from '../lib/geo'

/** 確定性亂數：線性同餘產生器。不得改用 Math.random()，否則測試無法重現。 */
function makeRng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

const TAIPEI_STATION = { lat: 25.0478, lng: 121.5170 }

interface DistrictSeed {
  city: string
  name: string
  lat: number
  lng: number
  /** 買賣單價 萬元/坪 */
  saleUnit: number
  /** 租金 元/坪/月 */
  rentUnit: number
  summerTemp: number
  winterTemp: number
  rainDays: number
  humidity: number
  aqi: number
  /** 生活機能豐富度 0..1，影響 POI 模擬值 */
  urbanity: number
  hasMetro: boolean
}

const DISTRICTS: DistrictSeed[] = [
  { city: '臺北市', name: '中正區', lat: 25.0324, lng: 121.5199, saleUnit: 90, rentUnit: 1350, summerTemp: 29.9, winterTemp: 16.6, rainDays: 166, humidity: 74, aqi: 42, urbanity: 0.95, hasMetro: true },
  { city: '臺北市', name: '大同區', lat: 25.0632, lng: 121.5130, saleUnit: 75, rentUnit: 1180, summerTemp: 29.9, winterTemp: 16.6, rainDays: 166, humidity: 75, aqi: 44, urbanity: 0.88, hasMetro: true },
  { city: '臺北市', name: '中山區', lat: 25.0685, lng: 121.5265, saleUnit: 88, rentUnit: 1320, summerTemp: 29.8, winterTemp: 16.7, rainDays: 165, humidity: 74, aqi: 43, urbanity: 0.94, hasMetro: true },
  { city: '臺北市', name: '松山區', lat: 25.0600, lng: 121.5570, saleUnit: 95, rentUnit: 1300, summerTemp: 29.8, winterTemp: 16.8, rainDays: 164, humidity: 74, aqi: 41, urbanity: 0.92, hasMetro: true },
  { city: '臺北市', name: '大安區', lat: 25.0263, lng: 121.5436, saleUnit: 110, rentUnit: 1450, summerTemp: 29.7, winterTemp: 16.8, rainDays: 165, humidity: 74, aqi: 40, urbanity: 0.97, hasMetro: true },
  { city: '臺北市', name: '萬華區', lat: 25.0286, lng: 121.4997, saleUnit: 65, rentUnit: 1050, summerTemp: 30.0, winterTemp: 16.7, rainDays: 166, humidity: 75, aqi: 45, urbanity: 0.85, hasMetro: true },
  { city: '臺北市', name: '信義區', lat: 25.0330, lng: 121.5654, saleUnit: 105, rentUnit: 1420, summerTemp: 29.7, winterTemp: 16.9, rainDays: 166, humidity: 74, aqi: 40, urbanity: 0.96, hasMetro: true },
  { city: '臺北市', name: '士林區', lat: 25.0928, lng: 121.5240, saleUnit: 75, rentUnit: 1120, summerTemp: 29.4, winterTemp: 16.3, rainDays: 172, humidity: 77, aqi: 38, urbanity: 0.78, hasMetro: true },
  { city: '臺北市', name: '北投區', lat: 25.1320, lng: 121.5017, saleUnit: 60, rentUnit: 980, summerTemp: 29.0, winterTemp: 15.9, rainDays: 178, humidity: 79, aqi: 35, urbanity: 0.70, hasMetro: true },
  { city: '臺北市', name: '內湖區', lat: 25.0697, lng: 121.5945, saleUnit: 72, rentUnit: 1100, summerTemp: 29.6, winterTemp: 16.5, rainDays: 170, humidity: 76, aqi: 39, urbanity: 0.80, hasMetro: true },
  { city: '臺北市', name: '南港區', lat: 25.0553, lng: 121.6069, saleUnit: 78, rentUnit: 1080, summerTemp: 29.6, winterTemp: 16.5, rainDays: 172, humidity: 76, aqi: 40, urbanity: 0.75, hasMetro: true },
  { city: '臺北市', name: '文山區', lat: 24.9887, lng: 121.5705, saleUnit: 62, rentUnit: 980, summerTemp: 29.2, winterTemp: 16.1, rainDays: 180, humidity: 79, aqi: 34, urbanity: 0.72, hasMetro: true },
  { city: '新北市', name: '板橋區', lat: 25.0096, lng: 121.4595, saleUnit: 55, rentUnit: 900, summerTemp: 30.1, winterTemp: 16.5, rainDays: 160, humidity: 75, aqi: 47, urbanity: 0.90, hasMetro: true },
  { city: '新北市', name: '新莊區', lat: 25.0359, lng: 121.4506, saleUnit: 45, rentUnit: 820, summerTemp: 30.2, winterTemp: 16.4, rainDays: 158, humidity: 75, aqi: 49, urbanity: 0.82, hasMetro: true },
  { city: '新北市', name: '中和區', lat: 25.0000, lng: 121.4990, saleUnit: 48, rentUnit: 850, summerTemp: 30.0, winterTemp: 16.5, rainDays: 162, humidity: 76, aqi: 46, urbanity: 0.84, hasMetro: true },
  { city: '新北市', name: '永和區', lat: 25.0079, lng: 121.5150, saleUnit: 55, rentUnit: 900, summerTemp: 30.0, winterTemp: 16.6, rainDays: 162, humidity: 75, aqi: 45, urbanity: 0.88, hasMetro: true },
  { city: '新北市', name: '三重區', lat: 25.0616, lng: 121.4874, saleUnit: 45, rentUnit: 830, summerTemp: 30.1, winterTemp: 16.5, rainDays: 160, humidity: 75, aqi: 48, urbanity: 0.83, hasMetro: true },
  { city: '新北市', name: '新店區', lat: 24.9679, lng: 121.5416, saleUnit: 50, rentUnit: 860, summerTemp: 29.3, winterTemp: 16.0, rainDays: 178, humidity: 79, aqi: 35, urbanity: 0.70, hasMetro: true },
  { city: '新北市', name: '土城區', lat: 24.9724, lng: 121.4436, saleUnit: 38, rentUnit: 760, summerTemp: 29.9, winterTemp: 16.2, rainDays: 168, humidity: 77, aqi: 44, urbanity: 0.65, hasMetro: true },
  { city: '新北市', name: '汐止區', lat: 25.0653, lng: 121.6420, saleUnit: 38, rentUnit: 750, summerTemp: 29.5, winterTemp: 16.2, rainDays: 186, humidity: 81, aqi: 38, urbanity: 0.60, hasMetro: false },
]

const BUILDING_TYPES = ['電梯大樓', '公寓', '華廈', '透天厝', '套房'] as const

const LISTINGS_PER_DISTRICT_PER_MODE = 9

interface Row {
  id: string; source: string; sourceId: string; mode: 'sale' | 'rent'
  url: string; title: string; scrapedAt: number
  city: string; district: string; address: string; lat: number; lng: number
  price: number; unitPrice: number; area: number; layout: string; rooms: number
  floor: number; totalFloor: number; age: number; buildingType: string
  hasElevator: number; hasParking: number
  f: Record<string, number | null>
}

function build(): Row[] {
  const rng = makeRng(20260817)
  const rows: Row[] = []

  for (const d of DISTRICTS) {
    for (const mode of ['sale', 'rent'] as const) {
      for (let i = 0; i < LISTINGS_PER_DISTRICT_PER_MODE; i++) {
        const jitter = () => (rng() - 0.5) * 0.018
        const lat = d.lat + jitter()
        const lng = d.lng + jitter()

        const buildingType = BUILDING_TYPES[Math.floor(rng() * BUILDING_TYPES.length)]
        const isStudio = buildingType === '套房'
        const rooms = isStudio ? 1 : 1 + Math.floor(rng() * 4)
        const area = isStudio
          ? 8 + rng() * 8
          : (mode === 'sale' ? 18 : 12) + rooms * 6 + rng() * 12
        const age = buildingType === '公寓' ? 25 + rng() * 25 : rng() * 35
        const totalFloor = buildingType === '透天厝' ? 3 + Math.floor(rng() * 2) : 5 + Math.floor(rng() * 15)
        const floor = 1 + Math.floor(rng() * totalFloor)

        const unitMul = 0.8 + rng() * 0.45 - Math.min(age, 40) / 200
        const unitPrice = (mode === 'sale' ? d.saleUnit : d.rentUnit) * unitMul
        const price = mode === 'sale'
          ? Math.round(unitPrice * area)
          : Math.round((unitPrice * area) / 100) * 100

        const distToMetro = d.hasMetro ? 120 + rng() * 1600 : 2200 + rng() * 3000
        const nearRail = distToMetro <= 800
        const commute = estimateCommuteMinutes(lat, lng, TAIPEI_STATION.lat, TAIPEI_STATION.lng, nearRail)
        const u = d.urbanity
        const poi = (base: number, r: number) => Math.round(base * u * (0.6 + rng() * 0.8) * r)

        const id = `seed-${mode}-${d.city}${d.name}-${i}`
        rows.push({
          id,
          source: 'seed',
          sourceId: id,
          mode,
          url: 'https://example.invalid/seed',
          title: `${d.name}${buildingType} ${rooms}房 ${area.toFixed(1)}坪`,
          scrapedAt: 1_755_388_800_000,
          city: d.city,
          district: d.name,
          address: `${d.city}${d.name}示範路${1 + Math.floor(rng() * 300)}號`,
          lat, lng,
          price,
          unitPrice: Number(unitPrice.toFixed(2)),
          area: Number(area.toFixed(1)),
          layout: isStudio ? '開放式套房' : `${rooms}房${Math.min(rooms, 2)}廳${Math.max(1, rooms - 1)}衛`,
          rooms,
          floor,
          totalFloor,
          age: Number(age.toFixed(1)),
          buildingType,
          hasElevator: buildingType === '公寓' ? 0 : 1,
          hasParking: rng() > 0.45 ? 1 : 0,
          f: {
            annual_temp: Number(((d.summerTemp + d.winterTemp) / 2 + 0.4).toFixed(1)),
            summer_temp: d.summerTemp,
            winter_temp: d.winterTemp,
            rain_days: d.rainDays,
            humidity: d.humidity,
            sun_hours: Math.round(1500 - d.rainDays * 2.2),
            aqi_mean: d.aqi,
            poi_convenience_500: poi(6, 1), poi_convenience_1k: poi(6, 3.1),
            poi_supermarket_500: poi(2, 1), poi_supermarket_1k: poi(2, 3.0),
            poi_school_500: poi(2, 1), poi_school_1k: poi(2, 2.8),
            poi_hospital_500: poi(1, 1), poi_hospital_1k: poi(1, 3.2),
            poi_park_500: poi(2, 1), poi_park_1k: poi(2, 2.9),
            poi_restaurant_500: poi(14, 1), poi_restaurant_1k: poi(14, 3.0),
            dist_to_metro: d.hasMetro ? Math.round(distToMetro) : null,
            dist_to_train: Math.round(900 + rng() * 5200),
            dist_to_bus: Math.round(60 + rng() * 500),
            commute_to_cbd_min: Number(commute.toFixed(1)),
            district_median_unit_price: mode === 'sale' ? d.saleUnit : d.rentUnit,
            price_percentile: null, // Step 13 回填
            dist_to_main_road: Math.round(40 + rng() * 700),
            dist_to_rail: Math.round(200 + rng() * 3000),
          },
        })
      }
    }
  }
  return rows
}

/** 同 mode + city + district + buildingType 分組計算單價百分位 */
function fillPercentiles(rows: Row[]): void {
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const key = `${r.mode}|${r.city}|${r.district}|${r.buildingType}`
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => a.unitPrice - b.unitPrice)
    sorted.forEach((r, i) => {
      r.f.price_percentile = sorted.length === 1 ? 0.5 : i / (sorted.length - 1)
    })
  }
}

function main(): void {
  mkdirSync('./data', { recursive: true })
  const db = new Database(process.env.DATABASE_PATH ?? './data/app.db')
  const rows = build()
  fillPercentiles(rows)

  db.exec('DELETE FROM listing_features; DELETE FROM listings; DELETE FROM districts;')

  const insertDistrict = db.prepare(
    `INSERT INTO districts (id, city, name, centroid_lat, centroid_lng, boundary)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  )
  const insertListing = db.prepare(
    `INSERT INTO listings (id, source, source_id, mode, url, title, scraped_at, city, district,
      address, lat, lng, price, unit_price, area, layout, rooms, floor, total_floor, age,
      building_type, has_elevator, has_parking)
     VALUES (@id, @source, @sourceId, @mode, @url, @title, @scrapedAt, @city, @district,
      @address, @lat, @lng, @price, @unitPrice, @area, @layout, @rooms, @floor, @totalFloor,
      @age, @buildingType, @hasElevator, @hasParking)`,
  )

  const featureCols = Object.keys(rows[0].f)
  const insertFeatures = db.prepare(
    `INSERT INTO listing_features (listing_id, ${featureCols.join(', ')})
     VALUES (?, ${featureCols.map(() => '?').join(', ')})`,
  )

  db.transaction(() => {
    for (const d of DISTRICTS) {
      insertDistrict.run(`${d.city}-${d.name}`, d.city, d.name, d.lat, d.lng)
    }
    for (const r of rows) {
      const { f, ...listing } = r
      insertListing.run(listing)
      insertFeatures.run(r.id, ...featureCols.map((c) => f[c]))
    }
  })()

  const count = db.prepare('SELECT COUNT(*) AS n FROM listings').get() as { n: number }
  console.log(`已寫入 ${count.n} 筆物件、${DISTRICTS.length} 個行政區`)
  db.close()
}

main()
