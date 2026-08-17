'use client'

import { useEffect, useRef } from 'react'
import { WeightPanel } from './WeightPanel'
import type { SearchProfile, WeightKey } from '@/lib/types/profile'

interface Props {
  profile: SearchProfile
  onChange: (p: SearchProfile) => void
  highlighted: Partial<Record<WeightKey, { from: number; to: number }>>
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WeightPopover({ profile, onChange, highlighted, open, onOpenChange }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOpenChange(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false) }
    // 用 mousedown 而非 click：slider 拖到面板外放開時，click 會落在面板外而誤關
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        data-testid="weight-trigger"
        className="text-xs text-neutral-500 underline underline-offset-2 transition hover:text-neutral-900"
      >
        修改權重
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-2 w-80 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:w-full max-md:rounded-b-none">
          <WeightPanel profile={profile} onChange={onChange} highlighted={highlighted} />
        </div>
      )}
    </div>
  )
}
