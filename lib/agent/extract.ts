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

/**
 * 目前的條件現況接在 system instruction 之後，**不進 contents**。
 * 它是脈絡，不是任何人說過的話：放進對話序列的開頭會污染第一輪，
 * 放結尾會讓模型最後看到的是一坨 JSON 而不是使用者的請求。
 * 兩者都會讓萃取錨定到錯的東西，所以它屬於 system 層。
 */
export function buildSystemInstruction(profile: SearchProfile): string {
  return [
    EXTRACT_SYSTEM_PROMPT,
    '',
    '［目前條件現況，僅供你判斷要做哪些增量，不要重複設定］',
    JSON.stringify({
      mode: profile.mode,
      weights: profile.weights,
      hard: profile.hard,
      soft: profile.soft,
    }),
  ].join('\n')
}

/** contents 只放真實對話，維持 user/model 交替，最後一則是使用者的話 */
export function buildContents(messages: ChatMessage[]): Content[] {
  return messages.slice(-MAX_TURNS * 2).map((m): Content => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
}

/** 呼叫 Gemini 萃取變動量。任何失敗都回空 delta，讓上層沿用原條件照樣排序。 */
export async function extractDelta(
  messages: ChatMessage[],
  profile: SearchProfile,
): Promise<ProfileDelta> {
  // 沒有對話就沒有東西可萃取，直接省下一次 API 呼叫
  if (messages.length === 0) return {}

  try {
    const response = await getGenAI().models.generateContent({
      model: getModel(),
      contents: buildContents(messages),
      config: {
        systemInstruction: buildSystemInstruction(profile),
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
