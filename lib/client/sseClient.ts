export interface SseEvent {
  event: string
  data: unknown
}

/**
 * 從串流緩衝區切出完整事件。未收完的尾段回傳為 rest，由呼叫端接續下一批。
 * 單一事件的 data 若不是合法 JSON，只跳過該事件，不影響其餘事件。
 */
export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = []
  const blocks = buffer.split('\n\n')
  const rest = blocks.pop() ?? ''

  for (const block of blocks) {
    let name = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) name = line.slice(7).trim()
      else if (line.startsWith('data: ')) dataLines.push(line.slice(6))
    }
    if (dataLines.length === 0) continue
    try {
      events.push({ event: name, data: JSON.parse(dataLines.join('\n')) })
    } catch {
      // 壞掉的單一事件直接跳過
    }
  }
  return { events, rest }
}
