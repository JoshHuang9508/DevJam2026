'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { PLACEHOLDERS, PLACEHOLDER_ROTATE_MS } from '@/lib/client/placeholders'

interface Props {
  onSubmit: (text: string) => void
  disabled: boolean
  large?: boolean
}

export function Composer({ onSubmit, disabled, large = false }: Props) {
  const [value, setValue] = useState('')
  const [placeholderIndex, setPlaceholderIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(
      () => setPlaceholderIndex((i) => (i + 1) % PLACEHOLDERS.length),
      PLACEHOLDER_ROTATE_MS,
    )
    return () => clearInterval(timer)
  }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (disabled || !value.trim()) return
    onSubmit(value)
    setValue('')
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={PLACEHOLDERS[placeholderIndex]}
        aria-label="描述你想要的居住條件"
        data-testid="composer-input"
        className={`min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none ${
          large ? 'px-4 py-3 text-base' : 'px-3 py-2 text-sm'
        }`}
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        data-testid="composer-submit"
        className={`shrink-0 rounded-lg bg-blue-600 font-medium text-white disabled:bg-neutral-300 ${
          large ? 'px-5 py-3' : 'px-3 py-2 text-sm'
        }`}
      >
        {disabled ? '思考中' : '送出'}
      </button>
    </form>
  )
}
