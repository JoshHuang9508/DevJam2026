/**
 * 臺北市 + 新北市的行政區重心。
 *
 * 用途有三個：geocoding 失敗時的退路、氣候／空品測站的最近鄰配對、以及 districts 表。
 * 座標是區公所一帶的概略重心，不是行政區界的幾何重心 —— 對「這筆物件大概在哪一區」
 * 這種用途夠了，要精確界線得另外抓 TGOS 的 SHP。
 */
export interface DistrictCentroid {
  city: string
  name: string
  lat: number
  lng: number
}

export const DISTRICTS: DistrictCentroid[] = [
  { city: '臺北市', name: '中正區', lat: 25.0324, lng: 121.5199 },
  { city: '臺北市', name: '大同區', lat: 25.0632, lng: 121.5130 },
  { city: '臺北市', name: '中山區', lat: 25.0685, lng: 121.5265 },
  { city: '臺北市', name: '松山區', lat: 25.0600, lng: 121.5570 },
  { city: '臺北市', name: '大安區', lat: 25.0263, lng: 121.5436 },
  { city: '臺北市', name: '萬華區', lat: 25.0286, lng: 121.4997 },
  { city: '臺北市', name: '信義區', lat: 25.0330, lng: 121.5654 },
  { city: '臺北市', name: '士林區', lat: 25.0928, lng: 121.5240 },
  { city: '臺北市', name: '北投區', lat: 25.1320, lng: 121.5017 },
  { city: '臺北市', name: '內湖區', lat: 25.0697, lng: 121.5945 },
  { city: '臺北市', name: '南港區', lat: 25.0553, lng: 121.6069 },
  { city: '臺北市', name: '文山區', lat: 24.9887, lng: 121.5705 },
  { city: '新北市', name: '板橋區', lat: 25.0096, lng: 121.4595 },
  { city: '新北市', name: '新莊區', lat: 25.0359, lng: 121.4506 },
  { city: '新北市', name: '中和區', lat: 25.0000, lng: 121.4990 },
  { city: '新北市', name: '永和區', lat: 25.0079, lng: 121.5150 },
  { city: '新北市', name: '三重區', lat: 25.0616, lng: 121.4874 },
  { city: '新北市', name: '新店區', lat: 24.9679, lng: 121.5416 },
  { city: '新北市', name: '土城區', lat: 24.9724, lng: 121.4436 },
  { city: '新北市', name: '汐止區', lat: 25.0653, lng: 121.6420 },
  { city: '新北市', name: '蘆洲區', lat: 25.0847, lng: 121.4739 },
  { city: '新北市', name: '樹林區', lat: 24.9903, lng: 121.4207 },
  { city: '新北市', name: '淡水區', lat: 25.1677, lng: 121.4406 },
  { city: '新北市', name: '林口區', lat: 25.0776, lng: 121.3915 },
  { city: '新北市', name: '三峽區', lat: 24.9345, lng: 121.3690 },
  { city: '新北市', name: '鶯歌區', lat: 24.9547, lng: 121.3540 },
  { city: '新北市', name: '五股區', lat: 25.0827, lng: 121.4380 },
  { city: '新北市', name: '泰山區', lat: 25.0587, lng: 121.4310 },
  { city: '新北市', name: '八里區', lat: 25.1512, lng: 121.3982 },
  { city: '新北市', name: '深坑區', lat: 25.0022, lng: 121.6157 },
]

/**
 * 實價登錄的檔名前綴 → 縣市。整包 zip 本來就涵蓋全台，這裡列出哪些要收。
 * 22 個縣市全開，實測本期檔就有買賣 10,890 筆、租賃 6,293 筆。
 */
export const LVR_CITY_PREFIX: Record<string, string> = {
  a: '臺北市', b: '臺中市', c: '基隆市', d: '臺南市', e: '高雄市', f: '新北市',
  g: '宜蘭縣', h: '桃園市', i: '嘉義市', j: '新竹縣', k: '苗栗縣', m: '南投縣',
  n: '彰化縣', o: '新竹市', p: '雲林縣', q: '嘉義縣', t: '屏東縣', u: '花蓮縣',
  v: '臺東縣', w: '金門縣', x: '澎湖縣', z: '連江縣',
}

/**
 * 縣市重心。這是 geocoding 全部失敗時的最後一道退路。
 *
 * 全台有 368 個鄉鎮市區，把它們全部硬寫進來不切實際；而且真正的解法是
 * geocode 成功後**從同一區已定位的物件算出重心**（見 pipeline 的兩段式定位）。
 * 這張表只在「整個縣市一筆都沒 geocode 成功」時才會用到 —— 例如沒有金鑰時。
 */
export const CITY_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  臺北市: { lat: 25.0375, lng: 121.5637 },
  新北市: { lat: 25.0169, lng: 121.4627 },
  基隆市: { lat: 25.1276, lng: 121.7392 },
  桃園市: { lat: 24.9937, lng: 121.3010 },
  新竹市: { lat: 24.8138, lng: 120.9675 },
  新竹縣: { lat: 24.8387, lng: 121.0177 },
  苗栗縣: { lat: 24.5602, lng: 120.8214 },
  臺中市: { lat: 24.1477, lng: 120.6736 },
  彰化縣: { lat: 24.0518, lng: 120.5161 },
  南投縣: { lat: 23.9609, lng: 120.9719 },
  雲林縣: { lat: 23.7092, lng: 120.4313 },
  嘉義市: { lat: 23.4801, lng: 120.4491 },
  嘉義縣: { lat: 23.4518, lng: 120.2555 },
  臺南市: { lat: 22.9999, lng: 120.2269 },
  高雄市: { lat: 22.6273, lng: 120.3014 },
  屏東縣: { lat: 22.5519, lng: 120.5487 },
  宜蘭縣: { lat: 24.7021, lng: 121.7378 },
  花蓮縣: { lat: 23.9871, lng: 121.6015 },
  臺東縣: { lat: 22.7583, lng: 121.1444 },
  澎湖縣: { lat: 23.5712, lng: 119.5793 },
  金門縣: { lat: 24.4493, lng: 118.3767 },
  連江縣: { lat: 26.1608, lng: 119.9509 },
}

const byKey = new Map(DISTRICTS.map((d) => [`${d.city}${d.name}`, d]))

export function findDistrict(city: string, name: string): DistrictCentroid | null {
  return byKey.get(`${city}${name}`) ?? null
}
