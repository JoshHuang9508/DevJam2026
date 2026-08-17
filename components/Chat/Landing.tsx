'use client'

import { ModeToggle } from '@/components/ModeToggle/ModeToggle'
import { PLACEHOLDERS } from '@/lib/client/placeholders'
import type { Mode } from '@/lib/types/profile'
import { Composer } from './Composer'

interface Props {
  mode: Mode
  onModeChange: (m: Mode) => void
  onSubmit: (text: string) => void
  disabled: boolean
}

export function Landing({ mode, onModeChange, onSubmit, disabled }: Props) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-2xl">
        <h1 className="text-center text-3xl font-bold">安家</h1>
        <p className="mt-2 text-center text-sm text-neutral-500">
          用一句話描述你想要的生活，我幫你在台灣找到適合落腳的地方
        </p>

        <div className="mt-6 flex justify-center">
          <ModeToggle mode={mode} onChange={onModeChange} />
        </div>

        <div className="mt-4">
          <Composer onSubmit={onSubmit} disabled={disabled} large />
        </div>

        <ul className="mt-4 flex flex-wrap justify-center gap-2">
          {PLACEHOLDERS.map((p) => (
            <li key={p}>
              <button
                type="button"
                onClick={() => onSubmit(p)}
                disabled={disabled}
                className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-600 hover:border-blue-400 hover:text-blue-700 disabled:opacity-50"
              >
                {p.length > 24 ? `${p.slice(0, 24)}…` : p}
              </button>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-center text-xs text-neutral-400">
          目前使用示範資料，涵蓋臺北市與新北市。氣候為區域參考值，通勤時間為估計值。
        </p>
      </div>
    </main>
  )
}
