import type { ListingFeatures, ListingWithFeatures } from '@/lib/types/listing'

export function makeFeatures(o: Partial<ListingFeatures> = {}): ListingFeatures {
  return {
    annualTemp: 23.5, summerTemp: 29.5, winterTemp: 16.5,
    rainDays: 165, humidity: 75, sunHours: 1400, aqiMean: 42,
    poiConvenience500: 5, poiConvenience1k: 15,
    poiSupermarket500: 2, poiSupermarket1k: 6,
    poiSchool500: 2, poiSchool1k: 5,
    poiHospital500: 1, poiHospital1k: 3,
    poiPark500: 2, poiPark1k: 5,
    poiRestaurant500: 12, poiRestaurant1k: 40,
    distToMetro: 600, distToTrain: 2000, distToBus: 150, commuteToCbdMin: 25,
    districtMedianUnitPrice: 70, pricePercentile: 0.5,
    distToMainRoad: 300, distToRail: 1200,
    ...o,
  }
}

export type ListingOverride = Partial<Omit<ListingWithFeatures, 'features'>> & {
  features?: Partial<ListingFeatures>
}

export function makeListing(o: ListingOverride = {}): ListingWithFeatures {
  const { features, ...rest } = o
  return {
    id: 'L1', source: 'test', sourceId: 'L1', mode: 'sale',
    url: 'https://example.invalid/1', title: '測試物件', scrapedAt: 0,
    city: '臺北市', district: '大安區', address: '臺北市大安區測試路1號',
    lat: 25.0263, lng: 121.5436,
    price: 2000, unitPrice: 80, area: 25, layout: '2房2廳1衛', rooms: 2,
    floor: 5, totalFloor: 12, age: 10, buildingType: '電梯大樓',
    hasElevator: true, hasParking: true,
    features: makeFeatures(features),
    ...rest,
  }
}
