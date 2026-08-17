'use client'

import type { Mode } from '@/lib/types/profile'

const OPTIONS: Array<{ value: Mode; label: string }> = [
  { value: 'sale', label: '買房' },
  { value: 'rent', label: '租房' },
]

export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-neutral-100 p-0.5" role="group" aria-label="買賣或租賃">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={mode === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-[7px] px-2.5 py-1 text-xs font-medium transition ${
            mode === o.value
              ? 'bg-white text-neutral-900 shadow-[0_1px_2px_rgb(15_23_42_/_0.10)]'
              : 'text-neutral-500 hover:text-neutral-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
