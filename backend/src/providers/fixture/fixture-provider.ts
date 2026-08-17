import type {
  AmenityStats,
  ClimateStats,
  GeographyStats,
  HousingStats,
  LocationBase,
  SourceMetadata,
  TransportStats,
} from "../../domain/candidates/schema.js";
import type { PreferenceState } from "../../domain/preferences/schema.js";
import type { ProviderRegistry, ProviderResult } from "../types.js";

interface FixtureRow {
  location: LocationBase;
  climate: ClimateStats;
  housing: HousingStats;
  amenities: AmenityStats;
  transport: TransportStats;
  geography: GeographyStats;
}

// Column order matches row() below:
// id, region, city, district, lat, lng | avgTempC, rainfallMm, rainyDays, humidityPct
// medianRent, convenience/km2, supermarket/km2, hospitals/100k, clinics/100k, restaurants/km2, schools/km2, parks/km2
// railwayKm, hsrKm, mrtKm | busStops/km2, elevationM, coastalKm, densityPerKm2
const rows: FixtureRow[] = [
  // 臺北市 + 新北市: district set and climate values aligned with the frontend listing seed
  // (scripts/seed.ts) so district ranking and per-district listings tell the same story.
  row("tpe-zhongzheng", "北部", "臺北市", "中正區", 25.0324, 121.5199, 23.7, 1750, 166, 74, 27000, 22.2, 1.62, 0.81, 35, 119, 61, 6.1, 0.5, 0.6, 0.4, 1.4, 10, 20, 20_500),
  row("tpe-datong", "北部", "臺北市", "大同區", 25.0632, 121.5130, 23.7, 1750, 166, 75, 23500, 20.6, 1.5, 0.75, 33, 110, 56, 5.6, 0.9, 1, 0.5, 1.3, 6, 17, 22_500),
  row("tpe-zhongshan", "北部", "臺北市", "中山區", 25.068, 121.533, 23.7, 1725, 165, 74, 26000, 22, 1.6, 0.8, 35, 118, 60, 6, 1.1, 1.2, 0.45, 1.3, 35, 12, 16_000),
  row("tpe-songshan", "北部", "臺北市", "松山區", 25.0600, 121.5570, 23.7, 1725, 164, 74, 26000, 21.5, 1.56, 0.78, 34, 115, 59, 5.9, 1, 3.5, 0.5, 1.2, 8, 18, 22_000),
  row("tpe-daan", "北部", "臺北市", "大安區", 25.0263, 121.5436, 23.7, 1725, 165, 74, 29000, 22.7, 1.65, 0.82, 36, 122, 62, 6.2, 1.4, 2, 0.4, 1.4, 12, 20, 27_000),
  row("tpe-wanhua", "北部", "臺北市", "萬華區", 25.0286, 121.4997, 23.8, 1750, 166, 75, 21000, 19.9, 1.45, 0.72, 32, 107, 54, 5.4, 0.8, 1.6, 0.55, 1.2, 7, 15, 20_000),
  row("tpe-xinyi", "北部", "臺北市", "信義區", 25.0330, 121.5654, 23.7, 1750, 166, 74, 28500, 22.5, 1.63, 0.82, 36, 120, 61, 6.1, 2, 2.8, 0.5, 1.2, 15, 19, 21_000),
  row("tpe-shilin", "北部", "臺北市", "士林區", 25.0928, 121.5240, 23.3, 1800, 172, 77, 22500, 18.3, 1.33, 0.66, 29, 98, 50, 5, 4.5, 5, 0.8, 0.9, 40, 14, 8_700),
  row("tpe-beitou", "北部", "臺北市", "北投區", 25.1320, 121.5017, 22.9, 1875, 178, 79, 19500, 16.4, 1.19, 0.6, 26, 88, 45, 4.5, 6.5, 7, 0.9, 0.8, 60, 10, 5_500),
  row("tpe-neihu", "北部", "臺北市", "內湖區", 25.0697, 121.5945, 23.5, 1775, 170, 76, 22000, 18.7, 1.36, 0.68, 30, 100, 51, 5.1, 4, 3, 0.9, 0.9, 30, 16, 9_200),
  row("tpe-nangang", "北部", "臺北市", "南港區", 25.0553, 121.6069, 23.5, 1800, 172, 76, 21500, 17.6, 1.28, 0.64, 28, 94, 48, 4.8, 1, 1, 0.7, 0.9, 20, 20, 6_600),
  row("tpe-wenshan", "北部", "臺北市", "文山區", 24.9887, 121.5705, 23.1, 1900, 180, 79, 19500, 16.8, 1.22, 0.61, 27, 90, 46, 4.6, 6, 6.5, 0.8, 0.8, 55, 22, 10_500),
  row("ntpc-banqiao", "北部", "新北市", "板橋區", 25.011, 121.461, 23.7, 1675, 160, 75, 21000, 21.1, 1.53, 0.77, 33, 113, 57, 5.8, 0.8, 0.7, 0.5, 1.2, 22, 18, 24_000),
  row("ntpc-xinzhuang", "北部", "新北市", "新莊區", 25.0359, 121.4506, 23.7, 1650, 158, 75, 16500, 19.2, 1.39, 0.7, 31, 103, 52, 5.2, 1.2, 2.5, 0.6, 1.1, 12, 22, 19_500),
  row("ntpc-zhonghe", "北部", "新北市", "中和區", 25.0000, 121.4990, 23.7, 1700, 162, 76, 17000, 19.7, 1.43, 0.71, 31, 105, 54, 5.4, 3.5, 4, 0.6, 1.1, 15, 22, 19_500),
  row("ntpc-yonghe", "北部", "新北市", "永和區", 25.0079, 121.5150, 23.7, 1700, 162, 75, 18000, 20.6, 1.5, 0.75, 33, 110, 56, 5.6, 3, 3.5, 0.6, 1.2, 10, 20, 38_000),
  row("ntpc-sanchong", "北部", "新北市", "三重區", 25.0616, 121.4874, 23.7, 1675, 160, 75, 16500, 19.4, 1.41, 0.71, 31, 104, 53, 5.3, 2.5, 2.8, 0.5, 1.1, 6, 15, 19_000),
  row("ntpc-xindian", "北部", "新北市", "新店區", 24.9679, 121.5416, 23.1, 1875, 178, 79, 17000, 16.4, 1.19, 0.6, 26, 88, 45, 4.5, 8, 8.5, 0.9, 0.8, 50, 25, 4_300),
  row("ntpc-tucheng", "北部", "新北市", "土城區", 24.9724, 121.4436, 23.5, 1775, 168, 77, 15000, 15.2, 1.11, 0.55, 24, 82, 41, 4.2, 2, 4, 0.8, 0.9, 30, 24, 8_400),
  row("ntpc-xizhi", "北部", "新北市", "汐止區", 25.0653, 121.6420, 23.3, 1950, 186, 81, 15000, 14, 1.02, 0.51, 22, 75, 38, 3.8, 1, 5, null, 0.7, 35, 12, 5_100),
  row("hsc-east", "北部", "新竹市", "東區", 24.803, 120.971, 22.8, 1600, 118, 75, 19000, 12, 0.65, 0.3, 25, 78, 31, 4, 0.8, 6, null, 1, 18, 20, 9_000),
  row("txg-west", "中部", "臺中市", "西區", 24.143, 120.671, 23.6, 1500, 105, 74, 17500, 19, 0.8, 0.35, 26, 95, 48, 5, 1.2, 10, 2.2, 1.4, 29, 45, 20_000),
  row("txg-fengyuan", "中部", "臺中市", "豐原區", 24.252, 120.721, 23.1, 1550, 108, 75, 13500, 9, 0.45, 0.2, 20, 55, 23, 3, 0.9, 20, null, 0.9, 18, 85, 4_100),
  row("cha-changhua", "中部", "彰化縣", "彰化市", 24.075, 120.544, 23.7, 1300, 92, 74, 12500, 10, 0.4, 0.25, 23, 52, 25, 3.5, 0.65, 11, null, 0.9, 17, 25, 5_700),
  row("cyi-east", "南部", "嘉義市", "東區", 23.481, 120.454, 24.3, 1450, 96, 76, 11500, 11, 0.38, 0.22, 26, 59, 27, 3.7, 0.75, 12, null, 0.9, 20, 38, 4_500),
  row("tnn-east", "南部", "臺南市", "東區", 22.985, 120.224, 25.1, 1650, 89, 75, 15500, 16, 0.7, 0.34, 27, 83, 43, 5, 0.95, 9, null, 1.2, 27, 22, 13_000),
  row("tnn-yongkang", "南部", "臺南市", "永康區", 23.026, 120.253, 25.0, 1600, 87, 75, 13000, 10, 0.5, 0.25, 20, 58, 28, 3.5, 0.65, 11, null, 0.9, 19, 28, 6_400),
  row("khh-zuoying", "南部", "高雄市", "左營區", 22.6877, 120.2946, 25.5, 1800, 88, 74, 17000, 18, 0.8, 0.45, 29, 88, 42, 5, 1.05, 0.8, 0.7, 1.2, 31, 18, 10_500),
  row("khh-sanmin", "南部", "高雄市", "三民區", 22.648, 120.299, 25.6, 1750, 86, 74, 14500, 20, 0.72, 0.32, 31, 90, 45, 4.5, 0.7, 5.5, 0.6, 1.4, 28, 14, 17_500),
  row("pif-pingtung", "南部", "屏東縣", "屏東市", 22.676, 120.494, 25.4, 2050, 105, 77, 10500, 8, 0.3, 0.18, 20, 45, 20, 3.2, 0.55, 32, null, 0.8, 14, 42, 3_200),
  row("ila-luodong", "東部", "宜蘭縣", "羅東鎮", 24.676, 121.771, 22.9, 2800, 190, 81, 14000, 9, 0.42, 0.25, 21, 52, 26, 3.5, 0.85, 65, null, 0.9, 16, 11, 6_500),
  row("hua-hualien", "東部", "花蓮縣", "花蓮市", 23.991, 121.611, 23.8, 2100, 155, 78, 12000, 8, 0.3, 0.22, 25, 48, 24, 3.2, 0.9, null, null, 0.8, 13, 3, 3_500),
];

function row(
  id: string, region: LocationBase["region"], city: string, district: string, latitude: number, longitude: number,
  averageTemperatureC: number, annualRainfallMm: number, annualRainyDays: number, relativeHumidityPct: number,
  medianMonthlyRent: number, convenienceStoresPerKm2: number, supermarketsPerKm2: number, hospitalsPer100k: number,
  clinicsPer100k: number, restaurantsPerKm2: number, schoolsPerKm2: number, parksPerKm2: number,
  railwayDistanceKm: number | null, highSpeedRailDistanceKm: number | null, mrtDistanceKm: number | null,
  busStopsPerKm2: number | null, elevationM: number, coastalDistanceKm: number, populationDensityPerKm2: number,
): FixtureRow {
  return {
    location: { id, region, city, district, latitude, longitude },
    climate: { averageTemperatureC, summerHighC: averageTemperatureC + 7.5, winterLowC: averageTemperatureC - 8, annualRainfallMm, annualRainyDays, relativeHumidityPct },
    housing: { medianMonthlyRent, averageMonthlyRent: Math.round(medianMonthlyRent * 1.08), sampleSize: 120, currency: "TWD" },
    amenities: { convenienceStoresPerKm2, supermarketsPerKm2, hospitalsPer100k, clinicsPer100k, restaurantsPerKm2, schoolsPerKm2, parksPerKm2 },
    transport: { railwayDistanceKm, highSpeedRailDistanceKm, mrtDistanceKm, busStopsPerKm2: busStopsPerKm2 ?? 0 },
    geography: { elevationM, coastalDistanceKm, populationDensityPerKm2 },
  };
}

function metadata(domain: string): SourceMetadata {
  const sourceUrls: Record<string, string> = {
    climate: "https://opendata.cwa.gov.tw/",
    housing: "https://pip.moi.gov.tw/",
    amenities: "https://www.openstreetmap.org/",
    transport: "https://tdx.transportdata.tw/",
    geography: "https://data.gov.tw/",
  };
  return {
    provider: "fixture-v1",
    sourceName: `Development fixture inspired by ${domain} public datasets; not live statistics`,
    sourceUrl: sourceUrls[domain],
    fetchedAt: new Date().toISOString(),
    isFixture: true,
  };
}

function result<K extends keyof Omit<FixtureRow, "location">>(rowValue: FixtureRow, key: K): ProviderResult<FixtureRow[K]> {
  return { data: structuredClone(rowValue[key]), quality: "fixture", source: metadata(key) };
}

export function createFixtureProviders(): ProviderRegistry {
  const find = (id: string) => rows.find((item) => item.location.id === id);
  return {
    locations: {
      async search(preferences: PreferenceState) {
        const hard = preferences.hardConstraints;
        return rows.map((item) => item.location).filter((location) =>
          (!hard.regions?.length || hard.regions.includes(location.region)) &&
          (!hard.cities?.length || hard.cities.includes(location.city)) &&
          (!hard.districts?.length || hard.districts.includes(location.district) || hard.districts.includes(`${location.city}${location.district}`)) &&
          (!hard.excludedCities?.includes(location.city)) &&
          (!hard.excludedDistricts?.includes(location.district))
        ).map((location) => structuredClone(location));
      },
      async get(id: string) { return find(id)?.location ?? null; },
    },
    climate: { async getClimate(location) { const found = find(location.id); return found ? result(found, "climate") : missing(); } },
    housing: { async getHousingStats(location) { const found = find(location.id); return found ? result(found, "housing") : missing(); } },
    amenities: { async getAmenities(location) { const found = find(location.id); return found ? result(found, "amenities") : missing(); } },
    transport: { async getTransport(location) { const found = find(location.id); return found ? result(found, "transport") : missing(); } },
    geography: { async getGeography(location) { const found = find(location.id); return found ? result(found, "geography") : missing(); } },
  };
}

function missing<T>(): ProviderResult<T> {
  return { data: null, quality: "missing", source: null, warning: "Location is not available in fixture provider" };
}
