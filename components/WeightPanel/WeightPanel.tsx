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
    <section className="bg-white px-4 py-3" data-testid="weight-panel">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">權重</h2>
        {/*
          刻意不加 disabled：它會依 profile 算出 true/false，而瀏覽器擴充功能
          （會改寫 DOM 的那類）在 React hydrate 前把屬性拿掉，就會炸出
          "server rendered HTML didn't match" 的 hydration error。
          重設鍵在已是預設值時按下去本來就是 no-op，不需要停用。
          一併清掉 hard —— 那是硬條件濾到 0 筆時的逃生口。
        */}
        <button
          type="button"
          onClick={() => onChange({ ...profile, weights: { ...DEFAULT_PROFILE.weights }, hard: {} })}
          className="text-[11px] text-neutral-400 underline-offset-2 transition hover:text-neutral-800 hover:underline"
        >
          重設
        </button>
      </div>

      <ul className="space-y-3">
        {WEIGHT_KEYS.map((key) => {
          const change = highlighted[key]
          const value = profile.weights[key]
          return (
            <li key={key}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs leading-none">
                <span className="text-neutral-600">{WEIGHT_LABELS[key]}</span>
                {change ? (
                  <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
                    {change.from} → {change.to}
                  </span>
                ) : (
                  <span className="tabular-nums text-neutral-400">{value}</span>
                )}
              </div>
              <Slider.Root
                className="group relative flex h-4 w-full touch-none items-center"
                value={[value]}
                min={0}
                max={100}
                step={1}
                onValueChange={([v]) => setWeight(key, v)}
              >
                <Slider.Track className="relative h-[3px] w-full grow overflow-hidden rounded-full bg-neutral-200">
                  <Slider.Range className="absolute h-full rounded-full bg-neutral-800" />
                </Slider.Track>
                {/*
                  aria-label 必須放在 Thumb 上，不能放 Root。
                  Radix 只有 Thumb 帶 role="slider"，而且它只讀自己的 props，
                  不會從 Root 繼承；單一 thumb 時內建的 getLabel fallback 也回傳 undefined。
                  放錯位置 → 七個 slider 完全沒有無障礙名稱 → e2e 的
                  getByRole('slider', { name }) 一個都選不到。
                */}
                <Slider.Thumb
                  aria-label={WEIGHT_LABELS[key]}
                  className="block h-3.5 w-3.5 rounded-full border border-neutral-300 bg-white shadow-sm transition group-hover:border-neutral-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-1"
                />
              </Slider.Root>
              {/*
                只有風水需要這行：它是唯一預設為 0 的維度，滑桿看起來「在最左邊」
                很容易被誤讀成壞掉或沒生效。權重歸零後就補回一般的間距，不佔版面。
                提示放在 Slider.Root 之外，不碰 Thumb 的 aria-label（e2e 依賴它）。
              */}
              {key === 'fengshui' && value === 0 && (
                <p className="mt-1 text-[10px] leading-none text-neutral-400">
                  信仰性偏好，預設不參與排序；拉高才會影響順序
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
