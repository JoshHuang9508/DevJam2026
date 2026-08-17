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
    return true
  })
}
