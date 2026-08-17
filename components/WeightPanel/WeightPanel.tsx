'use client'

import * as Slider from '@radix-ui/react-slider'
import { DEFAULT_PROFILE, WEIGHT_KEYS, WEIGHT_LABELS, type SearchProfile, type WeightKey } from '@/lib/types/profile'

interface Props {
  profile: SearchProfile
  onChange: (next: SearchProfile) => void
  /** agent 剛調整過的維度 → 顯示變化並高亮 */
  highlighted: Partial<Record<WeightKey, { from: number; to: number }>>
}

export function WeightPanel({ profile, onChange, highlighted }: Props) {
  const setWeight = (key: WeightKey, value: number) => {
    onChange({ ...profile, weights: { ...profile.weights, [key]: value } })
  }

  return (
    <section className="border-t border-neutral-200 bg-white p-3" data-testid="weight-panel">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">權重</h2>
        <button
          type="button"
          onClick={() => onChange({ ...profile, weights: { ...DEFAULT_PROFILE.weights } })}
          className="text-xs text-neutral-500 underline hover:text-neutral-800"
        >
          重設
        </button>
      </div>

      <ul className="space-y-2.5">
        {WEIGHT_KEYS.map((key) => {
          const change = highlighted[key]
          return (
            <li key={key}>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="text-neutral-700">{WEIGHT_LABELS[key]}</span>
                {change ? (
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-800 tabular-nums">
                    {change.from} → {change.to}
                  </span>
                ) : (
                  <span className="tabular-nums text-neutral-400">{profile.weights[key]}</span>
                )}
              </div>
              <Slider.Root
                className="relative flex h-4 w-full touch-none items-center"
                value={[profile.weights[key]]}
                min={0}
                max={100}
                step={1}
                aria-label={WEIGHT_LABELS[key]}
                onValueChange={([v]) => setWeight(key, v)}
              >
                <Slider.Track className="relative h-1 w-full grow rounded-full bg-neutral-200">
                  <Slider.Range className="absolute h-full rounded-full bg-blue-600" />
                </Slider.Track>
                <Slider.Thumb className="block h-3.5 w-3.5 rounded-full border-2 border-blue-600 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400" />
              </Slider.Root>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
