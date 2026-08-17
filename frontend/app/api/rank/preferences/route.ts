import { NextResponse } from 'next/server'
import { areaCoverageNote, listingsDbAvailable } from '@/lib/backend/listings'
import { resolvePlace } from '@/lib/backend/place-anchor'
import { toSearchProfile } from '@/lib/backend/profile-bridge'
import { recallProfile } from '@/lib/backend/profile-cache'
import type { PreferenceState } from '@/lib/backend/types'
import { loadPool } from '@/lib/db/client'
import { rankWithRelaxation } from '@/lib/scoring/relax'
import { DEFAULT_PROFILE, WEIGHT_KEYS, type Mode } from '@/lib/types/profile'
import type { ScoredListing } from '@/lib/types/listing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 給後端 Pi agent 用的物件排序入口。
 *
 * 存在的理由是**只能有一個排序器**。agent 要能講出「這三間適合你」，就必須看到
 * 排好的物件；但如果在後端另外實作一份計分，UI 顯示的排名跟 agent 嘴巴講的排名
 * 會各自演化，最後對不起來 —— 使用者看到第一名是 A，agent 卻在誇 B。
 * 所以這裡直接吃後端的 PreferenceState，走前端既有的 toSearchProfile → lib/scoring，
 * 跟 /api/rank 與畫面上的卡片是同一條路徑、同一組分數。
 *
 * 回傳刻意做成精簡投影：ScoredListing 帶著四十幾個 feature 欄位，整包塞進 LLM
 * context 會吃掉幾萬 token，而 agent 只需要能說明取捨的那幾個欄位。
 */
const MAX_LIMIT = 20
const DEFAULT_LIMIT = 8

interface Body {
  preferences?: PreferenceState
  mode?: Mode
  limit?: number
  /** 模糊地點，例如「土城」「高雄」「南部」。座標由後端查表解析，不由模型提供。 */
  near?: { place?: string; radiusKm?: number }
  /** 用來取回這個 session 的 client profile 當 base，讓 agent 的排名與畫面一致。 */
  sessionId?: string
}

export async function POST(request: Request): Promise<Response> {
  let body: Body | null
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }

  if (!body?.preferences) {
    return NextResponse.json({ error: '缺少 preferences' }, { status: 400 })
  }
  if (!listingsDbAvailable()) {
    return NextResponse.json({ error: '物件資料庫尚未建立' }, { status: 503 })
  }

  // base 優先用這個 session 的 client profile：PreferenceState 轉回 SearchProfile 是有損的
  // （space / quality 權重、買賣模式的預算都不在後端欄位裡），拿 DEFAULT_PROFILE 當 base
  // 會讓 agent 排出來的名次跟畫面上的卡片對不起來。cache miss 就退回預設值。
  const remembered = recallProfile(body.sessionId)
  const base = remembered ?? DEFAULT_PROFILE
  const mode: Mode = body.mode === 'sale' || body.mode === 'rent' ? body.mode : base.mode
  const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)

  try {
    const profile = toSearchProfile(body.preferences, { ...base, mode })

    // 「靠近土城」「高雄附近」這類模糊地點。座標一律查 districts 表的真實重心解析，
    // 不讓模型自己給經緯度 —— 那種錯誤不會報錯，只會安靜地回傳錯誤區域的房子。
    // 解析不到就照實回報 unresolvedPlace，不硬猜一個地方。
    let anchor: ReturnType<typeof resolvePlace> = null
    if (body.near?.place) {
      anchor = resolvePlace(body.near.place, body.near.radiusKm)
      if (anchor) {
        profile.hard = {
          ...profile.hard,
          near: { lat: anchor.lat, lng: anchor.lng, radiusKm: anchor.radiusKm, label: anchor.label },
        }
      }
    }

    // 使用者指定的地區查不到就照實說，不再偷偷改成不限行政區 —— 那會讓 agent 拿著
    // 一堆別區的物件去回答「大安區有什麼」，比回答查不到更糟。
    const coverage = areaCoverageNote(mode, profile.hard)
    const notes = coverage ? [coverage] : []

    const { results, relaxations } = rankWithRelaxation(profile, loadPool(mode, profile.hard.cities))

    return NextResponse.json({
      mode,
      total: results.length,
      relaxations: [...notes, ...relaxations],
      // 讓 agent 知道地點被解析成什麼，才講得出「以新北市土城區為中心 5 公里內」
      resolvedPlace: anchor,
      unresolvedPlace: body.near?.place && !anchor ? body.near.place : undefined,
      weights: profile.weights,
      // agent 要能講出「我是在哪個範圍裡找的」，尤其是地區這種不會被放寬的條件
      hardConstraints: profile.hard,
      // 這一輪**實際**拿去計分的 profile。後端會原樣轉發給前端，前端用同一份重算 ——
      // 計分是確定性的，同樣的 profile + 同樣的池必然得出同樣的名次，所以只要輸入一致，
      // agent 嘴上講的與畫面顯示的就保證是同一批。傳 profile（約 1 KB）而不是把
      // 完整結果（50 筆約 120 KB）在兩個容器之間來回搬。
      effectiveProfile: profile,
      // agent 需要知道排名是否用了畫面上的權重；miss 時它的名次可能與卡片略有出入
      profileBase: remembered ? 'session' : 'default',
      listings: results.slice(0, limit).map(project),
    })
  } catch (error) {
    console.error('[api/rank/preferences] 排序失敗', error)
    return NextResponse.json({ error: '排序失敗' }, { status: 500 })
  }
}

/** 挑出 agent 說得出口的欄位，外加分數最高的三個維度當作推薦理由。 */
function project(listing: ScoredListing) {
  const top = WEIGHT_KEYS
    .map((key) => ({ key, ...listing.breakdown[key] }))
    .filter((d) => d.weight > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map((d) => ({ dimension: d.key, subscore: round(d.subscore), weight: round(d.weight) }))

  return {
    id: listing.id,
    title: listing.title,
    url: listing.url,
    city: listing.city,
    district: listing.district,
    address: listing.address,
    price: listing.price,
    unitPrice: listing.unitPrice,
    area: listing.area,
    layout: listing.layout,
    floor: listing.floor,
    totalFloor: listing.totalFloor,
    age: listing.age,
    buildingType: listing.buildingType,
    hasElevator: listing.hasElevator,
    hasParking: listing.hasParking,
    score: round(listing.score),
    topDimensions: top,
    distToMetro: listing.features.distToMetro,
    commuteToCbdMin: listing.features.commuteToCbdMin,
    pricePercentile: listing.features.pricePercentile,
    // 有缺值的維度要讓 agent 知道，才說得出「這筆的通勤資料缺，分數僅供參考」
    dataGaps: listing.dataGaps,
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
