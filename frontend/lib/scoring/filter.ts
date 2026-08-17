import { FENGSHUI_HIT, ruleRisk } from '@/lib/fengshui/audit'
import type { ListingWithFeatures } from '@/lib/types/listing'
import type { SearchProfile } from '@/lib/types/profile'

/**
 * 硬性條件過濾。缺值一律**不排除** —
 * 資料不足不等於不合格，排除會讓結果無聲消失。
 */
export function applyHardFilter(
  pool: ListingWithFeatures[],
  p: SearchProfile,
): ListingWithFeatures[] {
  const h = p.hard
  return pool.filter((l) => {
    if (l.mode !== p.mode) return false
    if (h.cities?.length && !h.cities.includes(l.city)) return false
    if (h.districts?.length && !h.districts.includes(l.district)) return false
    if (h.budgetMin !== undefined && l.price < h.budgetMin) return false
    if (h.budgetMax !== undefined && l.price > h.budgetMax) return false
    if (h.minArea !== undefined && l.area < h.minArea) return false
    if (h.minRooms !== undefined && l.rooms < h.minRooms) return false
    if (h.maxAge !== undefined && l.age > h.maxAge) return false
    if (h.buildingTypes?.length && !h.buildingTypes.includes(l.buildingType)) return false
    if (h.needElevator && !l.hasElevator) return false
    if (h.needParking && !l.hasParking) return false
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
