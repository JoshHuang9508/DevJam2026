import type { PreferencePatch } from "../domain/preferences/schema.js";

export function parsePreferencePatch(message: string): PreferencePatch | null {
  const patch: PreferencePatch = {};
  const hard: NonNullable<PreferencePatch["hardConstraints"]> = {};
  const soft: NonNullable<PreferencePatch["softPreferences"]> = {};
  const rentMatches = [...message.matchAll(/(?:月租|房租|房價)?[^0-9]{0,8}(\d{4,6})/g)];
  const rent = rentMatches.map((match) => Number(match[1])).find((value) => value >= 5_000 && value <= 200_000);
  if (rent && /(最高|以下|不能超過|可以到|上限)/.test(message)) hard.maxMonthlyRent = rent;

  if (/中南部/.test(message)) hard.regions = ["中部", "南部"];
  else if (/南部/.test(message)) hard.regions = ["南部"];
  else if (/中部/.test(message)) hard.regions = ["中部"];
  else if (/北部/.test(message)) hard.regions = ["北部"];
  else if (/東部/.test(message)) hard.regions = ["東部"];

  const cities = ["臺北市", "新北市", "新竹市", "臺中市", "彰化縣", "嘉義市", "臺南市", "高雄市", "屏東縣", "宜蘭縣", "花蓮縣"];
  const aliases: Record<string, string> = { 台北: "臺北市", 臺北: "臺北市", 台中: "臺中市", 臺中: "臺中市", 台南: "臺南市", 臺南: "臺南市", 高雄: "高雄市", 嘉義: "嘉義市", 新竹: "新竹市", 屏東: "屏東縣", 彰化: "彰化縣", 宜蘭: "宜蘭縣", 花蓮: "花蓮縣" };
  for (const [alias, city] of Object.entries(aliases)) {
    if (message.includes(alias) && /(不要|排除|移除)/.test(message)) hard.excludedCities = [...new Set([...(hard.excludedCities ?? []), city])];
  }
  const included = cities.filter((city) => message.includes(city) && !hard.excludedCities?.includes(city));
  if (included.length && /(只要|限定|想住|附近)/.test(message)) hard.cities = included;

  if (/(不要太常下雨|少雨|不喜歡下雨|怕下雨)/.test(message)) {
    soft.climate = { weight: 0.85, rainfall: { preference: "low", weight: 0.95 } };
  }
  if (/(怕熱|不要太熱|涼爽)/.test(message)) {
    soft.climate = { ...(soft.climate ?? {}), weight: 0.9, temperature: { preferredMax: 25, weight: 1 } };
  }
  if (/(生活機能.*好|生活方便|機能好)/.test(message)) {
    soft.amenities = { weight: 0.85, supermarket: 0.9, hospital: 0.85, convenienceStore: 0.75 };
  }
  if (/(交通.*重要|更在意交通|交通方便)/.test(message)) {
    soft.transportation = { weight: 0.95, railwayAccess: 0.85, mrtAccess: 0.85, busAccess: 0.6 };
    if (/(比生活機能重要|生活機能沒那麼重要)/.test(message)) soft.amenities = { ...(soft.amenities ?? {}), weight: 0.45 };
  }
  if (/(火車|台鐵|臺鐵)/.test(message)) soft.transportation = { ...(soft.transportation ?? {}), weight: 0.9, railwayAccess: 0.95 };
  if (/(捷運|MRT)/i.test(message)) soft.transportation = { ...(soft.transportation ?? {}), weight: 0.9, mrtAccess: 0.95 };
  if (/(房租|房價).*(貴一點沒關係|不重要|放寬)/.test(message)) soft.housing = { weight: 0.35 };

  if (Object.keys(hard).length) patch.hardConstraints = hard;
  if (Object.keys(soft).length) patch.softPreferences = soft;
  return Object.keys(patch).length ? patch : null;
}

