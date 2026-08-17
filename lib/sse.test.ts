import { describe, expect, it } from 'vitest'
import { sseEvent } from './sse'

describe('sseEvent', () => {
  it('產生合法的 SSE 區塊', () => {
    expect(sseEvent('ping', { a: 1 })).toBe('event: ping\ndata: {"a":1}\n\n')
  })

  it('字串內的換行不會破壞協定', () => {
    const out = sseEvent('text', { delta: '第一行\n第二行' })
    // JSON 序列化會把換行轉成 \\n，data 行必須維持單行
    expect(out.split('\n').filter((l) => l.startsWith('data: '))).toHaveLength(1)
  })

  it('中文不被轉義成 unicode 逃脫字元', () => {
    expect(sseEvent('text', { delta: '大安區' })).toContain('大安區')
  })
})
