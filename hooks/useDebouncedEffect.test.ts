import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleDebounced } from './useDebouncedEffect'

describe('scheduleDebounced', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('延遲後才執行', () => {
    const fn = vi.fn()
    scheduleDebounced(fn, 200)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('回傳的 cancel 可取消執行', () => {
    const fn = vi.fn()
    const cancel = scheduleDebounced(fn, 200)
    cancel()
    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()
  })
})
