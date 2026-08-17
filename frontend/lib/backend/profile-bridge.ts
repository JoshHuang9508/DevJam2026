import type { PreferencePatch, PreferenceState } from './types'
import { DEFAULT_PROFILE, REGIONS, normalizeCity, type Region, type SearchProfile } from '@/lib/types/profile'

/**
 * Translates between the frontend's SearchProfile (listing-level, 7 axes) and the
 * backend's PreferenceState (district-level, 5 axes). They are deliberately not the
 * same model, so the mapping is lossy in both directions:
 *
 *   price + value  <->  softPreferences.housing.weight   (2:1, delta-preserving)
 *   weather        <->  softPreferences.climate.weight
 *   location       <->  softPreferences.transportation.weight
 *   amenities      <->  softPreferences.amenities.weight
 *   fengshui       <->  listingPreferences.fengshuiWeight (1:1, delta-preserving)
 *   space, quality -> (no district-level equivalent; never overwritten)
 *   (none)         <-   softPreferences.geography.weight (district selection only)
 *
 * Hard constraints split the same way: region/city/rent live in the backend, while
 * 坪數/格局/屋齡/電梯/車位 stay listing-level and are passed through untouched.
 * `avoidFengshui` is the exception among the listing-level constraints: it round-trips,
 * because 「絕對不要穿堂煞」 has to be extractable from a sentence and the backend agent is
 * the only extractor left (the frontend Gemini path was removed in 7c5bdaf). The backend
 * stores both fengshui fields without scoring them — see backend listingPreferencesSchema.
 */

const clamp100 = (v: number): number => (v < 0 ? 0 : v > 100 ? 100 : Math.round(v))
const toWeight = (v: number): number => Math.min(1, Math.max(0, Number((v / 100).toFixed(2))))

/**
 * 回讀一條 1:1 的權重軸。後端沒動就沿用 client 的原值，避免 0..100 → 0..1 兩位小數 → 0..100
 * 往返造成的無謂位移；agent 真的動了才採用後端的值。與上面 housing 的 shift 是同一個道理。
 */
const agentMoved = (got: number, base: number): number => {
  const scaled = got * 100
  return Math.abs(scaled - base) < 0.5 ? base : clamp100(scaled)
}

/** SearchProfile -> PreferencePatch. Sends only what the backend can represent. */
export function toPreferencePatch(profile: SearchProfile): PreferencePatch {
  const w = profile.weights
  const patch: PreferencePatch = {
    softPreferences: {
      housing: { weight: toWeight((w.price + w.value) / 2) },
      climate: { weight: toWeight(w.weather) },
      transportation: { weight: toWeight(w.location) },
      amenities: { weight: toWeight(w.amenities) },
    },
    // always sent, including the empty array: deep-merge 對陣列是整體覆寫，所以送 [] 正是
    // 「取消避開」唯一能表達得出來的方式（後端沒有 null 清欄位的表示法）。
    listingPreferences: {
      fengshuiWeight: toWeight(w.fengshui),
      avoidFengshui: profile.hard.avoidFengshui ?? [],
    },
  }

  // 空陣列一律送 —— 與 avoidFengshui 同一個道理：deep-merge 對陣列是整體覆寫，
  // 送空陣列是「使用者取消了」唯一表達得出來的方式。只在非空時送的話，一旦設過就清不掉。
  const hard: NonNullable<PreferencePatch['hardConstraints']> = {
    regions: profile.hard.regions ?? [],
    excludedCities: profile.hard.excludedCities ?? [],
    excludedDistricts: profile.hard.excludedDistricts ?? [],
  }

  // cities / districts 只在**空的時候**送。
  //
  // 這兩個欄位在 client profile 裡幾乎都不是使用者填的，而是 toSearchProfile 從後端
  // 的選區排名推導出來的（UI 也沒有任何地方能讓使用者直接指定行政區）。原樣送回去，
  // agent 上一輪自己挑的區就變成這一輪的硬條件，search_locations 從此被鎖在原地 ——
  // 症狀是「權重有跟著對話變，但地區永遠不換」。
  //
  // 真正由使用者說出口的地區（「我只要台北」）是 agent 自己用 update_preferences
  // 寫進後端 state 的，本來就留在後端，不需要前端幫忙轉送。
  // 送空陣列則仍然必要：那是重設按鈕清掉後端既有地區的唯一手段。
  if (!profile.hard.cities?.length) hard.cities = []
  if (!profile.hard.districts?.length) hard.districts = []
  // The backend only models monthly rent, so budgets are meaningless in sale mode
  // (萬元總價 vs 元月租 differ by orders of magnitude).
  // 前端切換鈕的值每輪都送。agent 之後若從對話判斷出不同意圖會蓋過它 ——
  // 使用者說的話優先於他忘了點的按鈕。
  hard.mode = profile.mode

  // 預算的欄位與單位隨模式而不同：租賃是元月租，買賣是萬元總價。
  // 兩者量級差三個數量級，混用會讓條件不是完全失效就是把結果篩成 0 筆。
  const max = profile.hard.budgetMax
  const min = profile.hard.budgetMin
  if (profile.mode === 'rent') {
    if (typeof max === 'number' && max > 0) hard.maxMonthlyRent = Math.round(max)
    if (typeof min === 'number' && min > 0) hard.minMonthlyRent = Math.round(min)
  } else {
    if (typeof max === 'number' && max > 0) hard.maxTotalPriceWan = Math.round(max)
    if (typeof min === 'number' && min > 0) hard.minTotalPriceWan = Math.round(min)
  }
  if (Object.keys(hard).length > 0) patch.hardConstraints = hard

  return patch
}

/**
 * PreferenceState -> SearchProfile.
 * `base` is the client's current profile; anything the backend cannot express
 * (mode, 坪數/格局/屋況 weights and constraints, commute anchor) is carried over.
 *
 * 地區條件全部來自**使用者說過的話**（agent 用 update_preferences 寫進 hardConstraints），
 * 不再有「引擎替他挑的行政區」這一層 —— 那會讓使用者分不出哪些區是自己要的、
 * 哪些是系統塞的，而後者一旦被當成硬條件就等於系統偷偷替他縮小了範圍。
 */
export function toSearchProfile(
  preferences: PreferenceState,
  base: SearchProfile = DEFAULT_PROFILE,
): SearchProfile {
  const soft = preferences.softPreferences
  const hardIn = preferences.hardConstraints
  const listing = preferences.listingPreferences

  // housing is one axis for two sliders: shift both by the same delta so the user's
  // own price/value split survives an agent-driven change.
  const sentMean = (base.weights.price + base.weights.value) / 2
  const gotMean = soft.housing.weight * 100
  const shift = Math.abs(gotMean - sentMean) < 0.5 ? 0 : gotMean - sentMean

  const weights: SearchProfile['weights'] = {
    price: clamp100(base.weights.price + shift),
    value: clamp100(base.weights.value + shift),
    weather: clamp100(soft.climate.weight * 100),
    location: clamp100(soft.transportation.weight * 100),
    amenities: clamp100(soft.amenities.weight * 100),
    space: base.weights.space,
    quality: base.weights.quality,
    // 後端不拿風水排行政區，但會存 agent 從對話萃取出來的值，所以這一維要讀回來。
    // 每個欄位都必須有值：漏掉會讓 weights.fengshui 變 undefined，normalizeWeights
    // 加總後整份權重變 NaN、排序全毀 —— 新增權重維度時這裡必須跟著補。
    fengshui: listing ? agentMoved(listing.fengshuiWeight, base.weights.fengshui) : base.weights.fengshui,
  }

  const hard: SearchProfile['hard'] = { ...base.hard }
  // 每一輪都把 client 的地區送上去，所以回來的空陣列代表「取消指定」而不是「後端沒這概念」。
  const areaIn = {
    regions: (hardIn.regions ?? []).filter((r): r is Region => (REGIONS as readonly string[]).includes(r)),
    cities: (hardIn.cities ?? []).map(normalizeCity),
    districts: hardIn.districts ?? [],
    excludedCities: (hardIn.excludedCities ?? []).map(normalizeCity),
    excludedDistricts: hardIn.excludedDistricts ?? [],
  }
  for (const key of Object.keys(areaIn) as Array<keyof typeof areaIn>) {
    const value = areaIn[key]
    if (value.length > 0) Object.assign(hard, { [key]: [...new Set(value)] })
    else delete hard[key]
  }
  // 我們每一輪都把 client 的值送上去，所以回來的空陣列代表「使用者/agent 取消了避開」，
  // 而不是後端沒有這個概念 —— 直接刪掉欄位，別留一個空陣列讓 filter 誤以為有條件。
  // listing 整個缺席才是「後端不認識這個欄位」，那種情況維持 base 不動。
  if (listing) {
    if (listing.avoidFengshui.length > 0) hard.avoidFengshui = [...listing.avoidFengshui]
    else delete hard.avoidFengshui
  }
  // mode 必須在預算對應**之前**決定：兩種模式的預算來自不同欄位、單位差三個數量級，
  // 用錯就是「兩千萬」被當成月租，結果直接 0 筆。
  const mode = hardIn.mode ?? base.mode
  if (mode === 'sale') {
    if (typeof hardIn.maxTotalPriceWan === 'number') hard.budgetMax = hardIn.maxTotalPriceWan
    if (typeof hardIn.minTotalPriceWan === 'number') hard.budgetMin = hardIn.minTotalPriceWan
  } else {
    if (typeof hardIn.maxMonthlyRent === 'number') hard.budgetMax = hardIn.maxMonthlyRent
    if (typeof hardIn.minMonthlyRent === 'number') hard.budgetMin = hardIn.minMonthlyRent
  }
  // 切換模式時舊模式的預算必須清掉，否則「兩千萬總價」會殘留成租屋的月租條件
  if (mode !== base.mode && hard.budgetMax === base.hard.budgetMax) {
    delete hard.budgetMax
    delete hard.budgetMin
  }

  const softOut: SearchProfile['soft'] = { ...base.soft }
  softOut.prefersLowRain = soft.climate.rainfall.preference === 'low'
  const preferredMax = soft.climate.temperature.preferredMax
  softOut.prefersCool = typeof preferredMax === 'number' && preferredMax <= 26

  return { mode, weights, hard, soft: softOut, notes: base.notes }
}

/** Weight axes the agent moved this turn, for the panel's `交通 20 → 40` badge. */
export function weightDiff(
  before: SearchProfile,
  after: SearchProfile,
): Partial<Record<keyof SearchProfile['weights'], { from: number; to: number }>> {
  const out: Partial<Record<keyof SearchProfile['weights'], { from: number; to: number }>> = {}
  for (const key of Object.keys(after.weights) as Array<keyof SearchProfile['weights']>) {
    const from = before.weights[key]
    const to = after.weights[key]
    if (from !== to) out[key] = { from, to }
  }
  return out
}
