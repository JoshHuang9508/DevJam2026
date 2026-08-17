'use client'

import { useEffect, type DependencyList } from 'react'

/** 純函式核心，可單元測試 */
export function scheduleDebounced(fn: () => void, delayMs: number): () => void {
  const timer = setTimeout(fn, delayMs)
  return () => clearTimeout(timer)
}

/** deps 變動後延遲 delayMs 才執行；期間再次變動會重新計時 */
export function useDebouncedEffect(
  fn: () => void,
  deps: DependencyList,
  delayMs: number,
): void {
  useEffect(() => scheduleDebounced(fn, delayMs), [...deps, delayMs]) // eslint-disable-line react-hooks/exhaustive-deps
}
