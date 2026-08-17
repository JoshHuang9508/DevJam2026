import { describe, expect, it } from 'vitest'
import { parseSseChunk } from './sseClient'

describe('parseSseChunk', () => {
  it('解析完整的單一事件', () => {
    const { events, rest } = parseSseChunk('event: text\ndata: {"delta":"哈囉"}\n\n')
    expect(events).toEqual([{ event: 'text', data: { delta: '哈囉' } }])
    expect(rest).toBe('')
  })

  it('解析同一批的多個事件', () => {
    const raw = 'event: profile\ndata: {"mode":"sale"}\n\nevent: done\ndata: {}\n\n'
    expect(parseSseChunk(raw).events.map((e) => e.event)).toEqual(['profile', 'done'])
  })

  it('不完整的事件留在 rest 等待下一段', () => {
    const { events, rest } = parseSseChunk('event: text\ndata: {"delta":"半')
    expect(events).toEqual([])
    expect(rest).toBe('event: text\ndata: {"delta":"半')
  })

  it('跨批次拼接後可正確解析', () => {
    const first = parseSseChunk('event: text\ndata: {"del')
    const second = parseSseChunk(first.rest + 'ta":"完整"}\n\n')
    expect(second.events).toEqual([{ event: 'text', data: { delta: '完整' } }])
  })

  it('data 不是合法 JSON 時跳過該事件而非整包失敗', () => {
    const { events } = parseSseChunk('event: text\ndata: 壞掉的\n\nevent: done\ndata: {}\n\n')
    expect(events).toEqual([{ event: 'done', data: {} }])
  })

  it('空字串回空結果', () => {
    expect(parseSseChunk('')).toEqual({ events: [], rest: '' })
  })
})
