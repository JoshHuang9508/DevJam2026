'use client'

import type { Mode } from '@/lib/types/profile'

const OPTIONS: Array<{ value: Mode; label: string }> = [
  { value: 'sale', label: '買房' },
  { value: 'rent', label: '租房' },
]

export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-neutral-300 p-0.5" role="group" aria-label="買賣或租賃">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={mode === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition ${
            mode === o.value ? 'bg-blue-600 text-white' : 'text-neutral-600 hover:bg-neutral-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
