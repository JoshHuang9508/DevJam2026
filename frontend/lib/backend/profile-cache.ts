import 'server-only'
import type { SearchProfile } from '@/lib/types/profile'

/**
 * 每個 session 最後一次送上來的 client profile。
 *
 * 為什麼需要：agent 的 rank_listings 會回打 /api/rank/preferences，而那裡只拿得到後端的
 * PreferenceState。PreferenceState → SearchProfile 的轉換不是無損的 —— toSearchProfile 會
 * 從 base profile 取 space / quality 權重、notes，買賣模式的預算也完全不在後端的欄位裡
 * （後端只模型化月租）。用 DEFAULT_PROFILE 當 base 的話，agent 排出來的前三名會跟畫面上
 * 卡片的前三名不一樣，使用者就會看到「agent 誇 A，但清單第一名是 B」。
 *
 * /api/agent/chat 與 /api/rank/preferences 跑在同一個 Next 行程裡，所以一個 Map 就夠。
 * 這也是它的限制：web 一旦跑多個 replica 就會 cache miss。miss 時退回 DEFAULT_PROFILE，
 * 結果是排名略有出入而不是壞掉。
 */
const MAX_ENTRIES = 200

const cache = new Map<string, SearchProfile>()

export function rememberProfile(sessionId: string, profile: SearchProfile): void {
  // 重新 set 之前先 delete，讓這一筆移到 Map 的尾端 —— Map 保證插入順序，
  // 少了這一步，最舊的 key 會是「最早建立」而不是「最久沒用到」。
  cache.delete(sessionId)
  cache.set(sessionId, profile)
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

export function recallProfile(sessionId: string | undefined): SearchProfile | null {
  if (!sessionId) return null
  return cache.get(sessionId) ?? null
}
