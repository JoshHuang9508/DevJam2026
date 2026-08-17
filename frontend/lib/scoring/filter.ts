import { FENGSHUI_HIT, ruleRisk } from '@/lib/fengshui/audit'
import type { ListingWithFeatures } from '@/lib/types/listing'
import { citiesInRegions, normalizeCity, type HardConstraints, type SearchProfile } from '@/lib/types/profile'

/**
 * 地區條件是否把這筆物件排除掉。抽出來是因為它同時是硬篩的一段，也是
 * 「使用者指定的地區永遠不放寬」那條規則要單獨判斷的東西（見 relax.ts）。
 *
 * regions 與 cities 是**交集**：說了「北部」又說「臺北市」就是臺北市，
 * 而不是整個北部。exclude 一律優先於 include。
 */
export function areaExcludes(l: { city: string; district: string }, h: HardConstraints): boolean {
  const city = normalizeCity(l.city)
  if (h.excludedCities?.length && h.excludedCities.map(normalizeCity).includes(city)) return true
  if (h.excludedDistricts?.length && h.excludedDistricts.includes(l.district)) return true
  if (h.regions?.length && !citiesInRegions(h.regions).has(city)) return true
  if (h.cities?.length && !h.cities.map(normalizeCity).includes(city)) return true
  if (h.districts?.length && !h.districts.includes(l.district)) return true
  return false
}

/**
 * 硬性條件過濾。缺值一律**不排除** —
 * 資料不足不等於不合格，排除會讓結果無聲消失。
 * 地區是唯一的例外，但它不靠缺值判斷：city/district 是必填欄位，沒有「不知道在哪一區」的物件。
 */
export function applyHardFilter(
  pool: ListingWithFeatures[],
  p: SearchProfile,
): ListingWithFeatures[] {
  const h = p.hard
  return pool.filter((l) => {
    if (l.mode !== p.mode) return false
    if (areaExcludes(l, h)) return false
    if (h.budgetMin !== undefined && l.price < h.budgetMin) return false
    if (h.budgetMax !== undefined && l.price > h.budgetMax) return false
    if (h.minArea !== undefined && l.area < h.minArea) return false
    if (h.minRooms !== undefined && l.rooms < h.minRooms) return false
    if (h.maxAge !== undefined && l.age > h.maxAge) return false
    // 子字串比對而不是逐字相等：資料庫存的是「住宅大樓(11層含以上有電梯)」這種長字串，
    // 但使用者與 agent 講的是「大樓」。要求逐字相同的話這個條件永遠篩不到東西。
    if (h.buildingTypes?.length && !h.buildingTypes.some((t) => l.buildingType.includes(t))) return false
    if (h.needElevator && !l.hasElevator) return false
    if (h.needParking && !l.hasParking) return false
    // 「靠近土城」這類條件。座標是必填欄位（實價登錄每筆都 geocode 過），
    // 所以這裡不需要缺值豁免。
    if (h.near) {
      if (haversineKm(l.lat, l.lng, h.near.lat, h.near.lng) > h.near.radiusKm) return false
    }
    // 通勤時間是估計值（步行 + 直線距離換算），缺值一律不排除
    if (h.maxCommuteMinutes !== undefined) {
      const c = l.features.commuteToCbdMin
      if (c !== null && c > h.maxCommuteMinutes) return false
    }
    if (h.maxDistToMetro !== undefined) {
      const d = l.features.distToMetro
      if (d !== null && d > h.maxDistToMetro) return false
    }
    // 使用者明確點名要避開的風水忌諱才排除，且必須是「確定命中」：
    // ruleRisk 回 null 代表格局圖／街景還沒判讀出來，未檢測不等於有問題，缺值一樣不排除。
    // 注意這裡用未補值的 l.features —— 補值會把「不知道」變成同區中位數，
    // 那是排序用的近似值，不足以拿來把一間房子從結果裡刪掉。
    if (h.avoidFengshui?.length) {
      for (const key of h.avoidFengshui) {
        const risk = ruleRisk(key, l.features)
        if (risk !== null && risk >= FENGSHUI_HIT) return false
      }
    }
    return true
  })
}

/** 兩點間大圓距離（公里）。 */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(a))
}
