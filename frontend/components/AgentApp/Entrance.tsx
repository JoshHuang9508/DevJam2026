'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ModeToggle } from '@/components/ModeToggle/ModeToggle'
import { PLACEHOLDERS, PLACEHOLDER_ROTATE_MS } from '@/lib/client/placeholders'
import type { Mode } from '@/lib/types/profile'

interface Props {
  mode: Mode
  onModeChange: (m: Mode) => void
  onSubmit: (text: string) => void
  disabled: boolean
  /** 後端狀態文字，例如「pi-agent-core（LLM）」 */
  statusLabel: string
  statusOk: boolean
}

export function Entrance({ mode, onModeChange, onSubmit, disabled, statusLabel, statusOk }: Props) {
  const [value, setValue] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % PLACEHOLDERS.length), PLACEHOLDER_ROTATE_MS)
    return () => clearInterval(timer)
  }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (disabled || !value.trim()) return
    onSubmit(value)
    setValue('')
  }

  return (
    <div className="w-full max-w-2xl px-6" data-testid="entrance">
      <div className="mb-6 flex items-center justify-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${statusOk ? 'bg-emerald-500' : 'bg-neutral-300'}`} />
        <span className="text-[11px] text-neutral-400">{statusLabel}</span>
      </div>

      <h1 className="text-center text-3xl font-bold tracking-tight text-neutral-900">安家</h1>
      <p className="mt-2 text-center text-sm text-neutral-500">
        用一句話描述你想要的生活，agent 會先選出適合的行政區，再從那些區裡挑物件
      </p>

      <div className="mt-6 flex justify-center">
        <ModeToggle mode={mode} onChange={onModeChange} />
      </div>

      <form onSubmit={submit} className="mt-4 flex gap-2">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          // 輸入法確認選字的 Enter 會觸發 form 的隱含送出，把組字中的半句話送出去；
          // 組字中就把這一下擋掉（同 AgentApp 的 textarea）
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault()
          }}
          placeholder={PLACEHOLDERS[index]}
          aria-label="描述你想要的居住條件"
          data-testid="composer-input"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-4 py-3 text-base outline-none transition placeholder:text-neutral-400 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          data-testid="composer-submit"
          className="shrink-0 rounded-lg bg-neutral-900 px-5 py-3 font-medium text-white transition hover:bg-neutral-700 disabled:opacity-30"
        >
          {disabled ? '思考中' : '送出'}
        </button>
      </form>

      <ul className="mt-4 flex flex-wrap justify-center gap-2">
        {PLACEHOLDERS.map((p) => (
          <li key={p}>
            <button
              type="button"
              onClick={() => {
                setValue(p)
                const input = inputRef.current
                if (!input) return
                input.focus()
                requestAnimationFrame(() => input.setSelectionRange(p.length, p.length))
              }}
              disabled={disabled}
              className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-600 transition hover:border-neutral-900 hover:text-neutral-900 disabled:opacity-40"
            >
              {p.length > 22 ? `${p.slice(0, 22)}…` : p}
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-center text-xs text-neutral-400">
        價格與生活機能取自公開資料，可能過時或有誤。氣候為區域參考值，通勤時間為估計值，風水格局證據為模擬值。
      </p>
    </div>
  )
}
