import { FunctionCallingConfigMode, type Content } from '@google/genai'
import { profileDeltaSchema } from '@/lib/profile/schema'
import type { ProfileDelta } from '@/lib/profile/merge'
import type { ChatMessage } from '@/lib/types/chat'
import type { SearchProfile } from '@/lib/types/profile'
import { getGenAI, getModel } from './client'
import { EXTRACT_SYSTEM_PROMPT } from './prompts'
import { UPDATE_PROFILE_DECLARATION, UPDATE_PROFILE_FUNCTION_NAME } from './tools'

/** 只送最近 6 輪（12 則）以控制 token */
const MAX_TURNS = 6

/** 驗證模型輸出。任何不合法內容都被丟棄，絕不讓單一幻覺欄位炸掉整包。 */
export function parseFunctionCall(args: unknown): ProfileDelta {
  const parsed = profileDeltaSchema.safeParse(args)
  return parsed.success ? (parsed.data as ProfileDelta) : {}
}

export function buildContents(messages: ChatMessage[], profile: SearchProfile): Content[] {
  const recent = messages.slice(-MAX_TURNS * 2)
  const state: Content = {
    role: 'user',
    parts: [{
      text: `［目前條件現況，僅供你判斷要做哪些增量，不要重複設定］\n${JSON.stringify({
        mode: profile.mode,
        weights: profile.weights,
        hard: profile.hard,
        soft: profile.soft,
      })}`,
    }],
  }
  // 現況說明放在對話「之後」（緊鄰生成點），而非最前面：
  // 一來讓每則真實對話的 index 不被現況區塊往後推一格，
  // 二來越靠近生成點的內容對模型的影響力越大，正好對應「這是要做增量判斷的基準」這個用途。
  return [
    ...recent.map((m): Content => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    state,
  ]
}

/** 呼叫 Gemini 萃取變動量。任何失敗都回空 delta，讓上層沿用原條件照樣排序。 */
export async function extractDelta(
  messages: ChatMessage[],
  profile: SearchProfile,
): Promise<ProfileDelta> {
  try {
    const response = await getGenAI().models.generateContent({
      model: getModel(),
      contents: buildContents(messages, profile),
      config: {
        systemInstruction: EXTRACT_SYSTEM_PROMPT,
        temperature: 0,
        tools: [{ functionDeclarations: [UPDATE_PROFILE_DECLARATION] }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: [UPDATE_PROFILE_FUNCTION_NAME],
          },
        },
      },
    })
    const call = response.functionCalls?.find((c) => c.name === UPDATE_PROFILE_FUNCTION_NAME)
    return parseFunctionCall(call?.args)
  } catch (error) {
    console.error('[agent/extract] 萃取失敗，沿用原條件', error)
    return {}
  }
}
