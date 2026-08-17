import { describe, expect, it } from 'vitest'
import { extractDelta } from './extract'
import { DEFAULT_PROFILE } from '@/lib/types/profile'

// 需要真實金鑰，會產生費用。執行方式：
//   RUN_LLM_TESTS=1 pnpm vitest run lib/agent/extract.integration.test.ts
const maybe = process.env.RUN_LLM_TESTS && process.env.GEMINI_API_KEY ? describe : describe.skip

maybe('extractDelta（真實呼叫 Gemini）', () => {
  it('把明確的預算數字寫進 hard.budgetMax', async () => {
    const d = await extractDelta(
      [{ role: 'user', content: '我想在台北買房，總價 1500 萬以內' }],
      DEFAULT_PROFILE,
    )
    expect(d.hard?.budgetMax).toBe(1500)
  }, 30_000)

  it('模糊的「不要太貴」不設 budgetMax，改為提高 price 權重', async () => {
    const d = await extractDelta(
      [{ role: 'user', content: '想找不要太貴的房子' }],
      DEFAULT_PROFILE,
    )
    expect(d.hard?.budgetMax).toBeUndefined()
    expect(d.weightsDelta?.price ?? 0).toBeGreaterThan(0)
  }, 30_000)

  it('「我更在乎交通」只調整 location，不動其他維度', async () => {
    const d = await extractDelta(
      [{ role: 'user', content: '我更在乎交通方便' }],
      DEFAULT_PROFILE,
    )
    expect(d.weightsDelta?.location ?? 0).toBeGreaterThan(0)
    expect(Object.keys(d.weightsDelta ?? {})).toEqual(['location'])
  }, 30_000)

  it('「我在信義區上班」寫成 commuteAnchor', async () => {
    const d = await extractDelta(
      [{ role: 'user', content: '我在信義區上班，通勤希望半小時內' }],
      DEFAULT_PROFILE,
    )
    expect(d.soft?.commuteAnchor).toBeDefined()
    expect(d.soft?.commuteAnchor?.lat).toBeGreaterThan(24)
    expect(d.soft?.commuteAnchor?.lat).toBeLessThan(26)
  }, 30_000)
})
