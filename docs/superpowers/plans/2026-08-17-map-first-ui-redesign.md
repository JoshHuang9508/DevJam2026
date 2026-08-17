# 地圖優先 UI 改版 — 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/` 改成地圖優先的介面 —— 置中入口、地圖從右滑入、物件欄可收納、權重改浮動面板、圖示 hover 預覽與點選鎖定放大置中。同時移除 Gemini 路徑與 `/classic`。

**Architecture:** 不換 route、不替換元件。入口與工作畫面是同一棵 React 樹，`started` 只驅動 CSS `transform`。地圖實例只建立一次。`hoveredId` 與 `selectedId` 是兩個獨立狀態。

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict / Tailwind v4 / MapLibre GL JS 6（DOM Marker）/ Vitest / Playwright / pnpm

**Spec:** `docs/superpowers/specs/2026-08-17-map-first-ui-redesign.md`

## Global Constraints

- Node.js 20+，套件管理器一律 `pnpm`（不在 PATH 時位於 `/Users/huangchenhao/.npm-global/bin/pnpm`）
- TypeScript `strict: true`，不得使用 `any` 規避型別錯誤
- 七個權重維度的鍵固定為：`price` `value` `weather` `location` `amenities` `space` `quality`
- 所有面向使用者的文字為繁體中文
- 配色統一 `neutral-900` 系，不得引入 `blue-*`
- 每個 task 結束時 `pnpm test` 必須全綠，且 `pnpm exec tsc --noEmit` 必須無錯。**`vitest` 不做型別檢查**，測試綠不等於型別正確
- **`backend/` 是獨立的 Node 專案**（自己的 `package.json`、Fastify、node ≥22.19），其相依套件不裝在根目錄。
  根 `tsconfig.json` 的 `include: ["**/*.ts"]` 會把它掃進 Next 的型別檢查而產生 47 個假錯誤。
  Task 1 會把它加進 `exclude`。在那之前，「`tsc` 乾淨」這個關卡是不可能達成的
- **地圖上沒有 cluster。** 圖示是 DOM `Marker`；`MapView` 的檔頭註解說明了為什麼不能用 geojson source（worker 在此環境會被關掉，source 永遠 loading 且不拋錯）。任何「回到 cluster 圖層」的念頭都超出本計畫範圍
- `lib/scoring/`、`lib/profile/`、`lib/db/`、`lib/backend/` 一律不動

---

### Task 1: 移除 Gemini 路徑與 `/classic`

先刪再建。留著死程式碼做版面重構，會讓後面每個 task 都要判斷「這個檔案還算不算數」。

**Files:**
- Delete: `app/classic/page.tsx`, `app/api/chat/route.ts`
- Delete: `components/Chat/Landing.tsx`, `components/Chat/ChatPanel.tsx`, `components/Chat/Composer.tsx`
- Delete: `components/HardConstraints/HardConstraints.tsx`
- Delete: `hooks/useChat.ts`
- Delete: `lib/agent/` 全部（`client.ts` `extract.ts` `extract.test.ts` `extract.integration.test.ts` `explain.ts` `explain.test.ts` `prompts.ts` `tools.ts`）
- Modify: `.env.example`, `README.md`, `lib/client/placeholders.ts`, `lib/types/chat.ts`
- Delete: `e2e/smoke.spec.ts` 中指向 `/classic` 的全部測試（整檔清空，Task 6 重建）

**Interfaces:**
- Consumes: 無
- Produces: 乾淨的樹，`pnpm test` 與 `tsc --noEmit` 皆通過

- [ ] **Step 1: 確認刪除邊界**

先跑一次，確認沒有漏網的引用：

```bash
grep -rn "lib/agent\|useChat\|HardConstraints\|components/Chat\|api/chat" app components hooks lib e2e --include=*.ts --include=*.tsx | grep -v "api/agent/chat"
```

`/api/agent/chat` 不是要刪的那個 —— 它是 Fastify 路徑，必須留。任何命中都要先處理再往下。

- [ ] **Step 2: 執行刪除**

```bash
git rm -r app/classic app/api/chat components/Chat components/HardConstraints lib/agent hooks/useChat.ts
```

- [ ] **Step 3: 保留 `lib/sse.ts` 並確認它還有人用**

```bash
grep -rn "lib/sse" app lib
```
Expected: 只剩 `app/api/agent/chat/route.ts`。**不要刪 `lib/sse.ts`** —— 它不專屬 Gemini。

- [ ] **Step 4: 例句移進 `placeholders.ts`**

`components/AgentApp/AgentApp.tsx` 目前內嵌 `EXAMPLES`。移到共用位置，入口與對話空狀態共用同一份。

`lib/client/placeholders.ts` 全檔替換為：
```ts
/** 入口輪播與對話空狀態共用的例句。內容對應 Fastify 後端的行政區推薦能力。 */
export const PLACEHOLDERS = [
  '我在臺北上班，月租兩萬以內，走路就有捷運，生活機能要好',
  '中南部，月租最高 18000，希望少雨而且生活方便',
  '房租可以到 25000，但交通比生活機能重要',
] as const

export const PLACEHOLDER_ROTATE_MS = 4500
```

`AgentApp.tsx` 刪掉自己的 `EXAMPLES` 常數，改 `import { PLACEHOLDERS } from '@/lib/client/placeholders'`，並把 `EXAMPLES.map` 換成 `PLACEHOLDERS.map`。

- [ ] **Step 5: 擴充 `lib/types/chat.ts`**

`AgentApp` 內嵌了自己的 `ChatMessage`。改用共用型別。

`lib/types/chat.ts` 全檔替換為：
```ts
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 串流進行中；完成後拿掉，UI 據此決定是否顯示游標 */
  streaming?: boolean
}
```

`AgentApp.tsx` 刪掉內嵌的 `interface ChatMessage`，改 `import type { ChatMessage } from '@/lib/types/chat'`。

- [ ] **Step 6: 清掉 Gemini 的環境變數與文件**

`.env.example` 移除 `GEMINI_API_KEY` 與 `GEMINI_MODEL` 兩行。若移除後檔案為空，保留一行註解說明目前不需要前端環境變數。

`README.md` 移除整節 `## ⚠️ Gemini 路徑尚未經過品質驗證`（含其下的「怎麼驗證」子節）。其餘章節不動。

- [ ] **Step 7: 清空 e2e**

`e2e/smoke.spec.ts` 全檔替換為：
```ts
import { test, expect } from '@playwright/test'

test('主畫面可載入', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toBeVisible()
})
```

這是刻意的暫時佔位。Task 6 對新版面重建完整套件。留一個會過的最小測試，比留一整套指向已刪頁面的紅燈好判斷。

- [ ] **Step 8: 把 `backend/` 排除在 Next 型別檢查之外**

根 `tsconfig.json` 的 `include` 是 `**/*.ts`，會把 `backend/`（獨立 Node 專案、相依套件不在根目錄）
一起掃進來，產生 47 個與本專案無關的錯誤，讓 `tsc --noEmit` 與 `pnpm build` 永遠是紅的。

`tsconfig.json` 的 `exclude` 加上 `"backend"`：
```json
  "exclude": [
    "node_modules",
    "backend"
  ]
```

`backend/` 有自己的 `tsconfig.json` 與建置流程，不受影響。

- [ ] **Step 9: 移除已無人使用的 `@google/genai`**

Gemini 路徑刪掉後，`package.json` 的 `@google/genai` 沒有任何程式碼引用了。

```bash
pnpm remove @google/genai
```

- [ ] **Step 10: README 的 `/classic` 與 Gemini 引用全面清乾淨**

Step 6 只移除了「Gemini 路徑尚未經過品質驗證」那節。但 README 還有五處在描述已不存在的東西：

- 快速開始的 `cp .env.example .env.local   # 需要 Gemini 路徑才要填 GEMINI_API_KEY` → 移除註解
- 路由表裡 `/classic` 那一列 → 整列刪除
- `` `/` 需要 `backend/` 有在跑；`/classic` 不需要… `` → 改寫成只講 `/`
- 指令表 `` `pnpm e2e` | 端對端測試（跑 `/classic`） `` → 改為「端對端測試」
- 安全章節提到 `/api/chat` 每次呼叫 Gemini 兩次 → 改為描述 `/api/agent/chat`

留著會讓文件指向一個已經不存在的頁面。

- [ ] **Step 11: 驗證**

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
```
Expected: 測試全綠（`lib/agent` 的 21 個單元測試與 4 個 skip 消失，其餘不變）、型別無錯、build 成功。

若 `tsc` 報出任何殘留引用，那是 Step 1 的 grep 沒抓乾淨，回頭處理，不要用 `any` 或 `@ts-ignore` 壓下去。

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor: 移除 Gemini 路徑與 /classic，例句與 ChatMessage 型別收斂"
```

Expected（Step 11）: `pnpm test` 119 綠、`tsc --noEmit` **零錯誤**（排除 backend 之後）、`pnpm build` 成功。
若 `tsc` 仍有錯，逐一判斷是不是 backend 以外的真問題，不要放寬 exclude 範圍去掩蓋。

---

### Task 2: `AgentApp` 串流改用 `parseSseChunk`

**Files:**
- Modify: `components/AgentApp/AgentApp.tsx`

**Interfaces:**
- Consumes: `parseSseChunk` from `lib/client/sseClient.ts`
- Produces: 行為不變的 `send()`，但解析交給有測試覆蓋的共用函式

- [ ] **Step 1: 讀懂現有解析**

`AgentApp.tsx` 的 `send()` 裡有一段手寫 SSE 解析：找 `\n\n` 邊界、正則抓 `event:`、濾出 `data:` 行、`JSON.parse` 包在 try 裡。

`lib/client/sseClient.ts` 的 `parseSseChunk(buffer)` 做完全一樣的事，回 `{ events, rest }`，且有 6 個測試覆蓋：跨 chunk 邊界重組、同批多事件、壞 JSON 只跳過該事件、空字串。

- [ ] **Step 2: 替換**

把 `while (true)` 讀取迴圈內從 `let boundary = buffer.indexOf('\n\n')` 到內層 `while` 結束的整段，換成：

```ts
        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = parseSseChunk(buffer)
        buffer = rest

        for (const { event: name, data } of events) {
          switch (name) {
            // ...原有的 session / districts / profile / results / text / error 分支原封不動
          }
        }
```

原本每個 case 內的邏輯**一行都不要改** —— 這個 task 只換解析器，不碰語意。

加上 import：
```ts
import { parseSseChunk } from '@/lib/client/sseClient'
```

- [ ] **Step 3: 驗證**

```bash
pnpm test lib/client/sseClient.test.ts
pnpm exec tsc --noEmit
pnpm build
```
Expected: 6 個測試通過、型別無錯、build 成功。

行為驗證需要 Fastify 後端在跑。若後端未啟動，`/api/agent/chat` 會回錯誤，此時確認 UI 顯示的是 `⚠️` 錯誤訊息而非白畫面或卡住，並在報告中說明後端狀態。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(agent): 串流解析改用有測試覆蓋的 parseSseChunk"
```

---

### Task 3: 入口與滑入轉場

**Files:**
- Create: `components/AgentApp/Entrance.tsx`
- Modify: `components/AgentApp/AgentApp.tsx`

**Interfaces:**
- Consumes: `PLACEHOLDERS`、`PLACEHOLDER_ROTATE_MS`、`ModeToggle`
- Produces: `<Entrance mode onModeChange onSubmit disabled status />`

- [ ] **Step 1: 建立入口元件**

`components/AgentApp/Entrance.tsx`:
```tsx
'use client'

import { useEffect, useState, type FormEvent } from 'react'
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
          value={value}
          onChange={(e) => setValue(e.target.value)}
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
              onClick={() => onSubmit(p)}
              disabled={disabled}
              className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-600 transition hover:border-neutral-900 hover:text-neutral-900 disabled:opacity-40"
            >
              {p.length > 22 ? `${p.slice(0, 22)}…` : p}
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-center text-xs text-neutral-400">
        目前使用示範資料，涵蓋臺北市與新北市。氣候為區域參考值，通勤時間為估計值。
      </p>
    </div>
  )
}
```

- [ ] **Step 2: 在 `AgentApp` 加入 `started` 與轉場容器**

`started` 由「已送出過第一則訊息」決定，直接用既有的 `messages.length > 0` 推導即可，不另存狀態：

```ts
const started = messages.length > 0
```

`AgentApp` 的 `return` 改為外層一個 relative 容器，入口與三欄同時存在、以 `transform` 與 `opacity` 切換：

```tsx
  return (
    <main className="relative flex h-screen overflow-hidden bg-neutral-50">
      {/* 入口：未開始時置中；開始後淡出並上移，不卸載
          inert 是必要的，不是加分項：opacity-0 不會把元素移出無障礙樹，
          Playwright 判斷可見也只看 bounding box 與 visibility/display、不看 opacity。
          少了它，入口與左欄的 ModeToggle 會同時存在兩個「買房」按鈕，
          Task 6 的 getByRole('button', { name: '買房' }) 會無條件 ambiguous 而失敗。 */}
      <div
        inert={started}
        className={`absolute inset-0 z-20 flex items-center justify-center bg-neutral-50 transition-[opacity,transform] duration-[240ms] ease-out motion-reduce:transition-none ${
          started ? 'pointer-events-none -translate-y-4 opacity-0' : 'translate-y-0 opacity-100'
        }`}
      >
        <Entrance
          mode={s.profile.mode}
          onModeChange={setMode}
          onSubmit={(text) => void send(text)}
          disabled={chatting}
          statusLabel={runtimeLabel}
          statusOk={status?.backendUp ?? false}
        />
      </div>

      {/* 左欄：對話。
          **不要做淡入。** 入口那層是 inset-0 且底色不透明，未開始時本來就把左欄整個蓋住；
          入口淡出時左欄自然被揭開。若左欄也跟著淡入，兩份標題列會在那 240ms 內同時可見。
          inert={!started} 的理由同入口那層。 */}
      <aside
        inert={!started}
        className="flex w-[380px] shrink-0 flex-col border-r border-neutral-200 bg-white"
      >
        {/* 標題列（安家 / ModeToggle / 狀態燈）與訊息串沿用現有內容，
            訊息容器要加 data-testid="chat-messages" */}
      </aside>

      {/* 中欄：地圖，從右滑入 */}
      <section
        className={`flex min-w-0 flex-1 flex-col transition-transform duration-[240ms] ease-out motion-reduce:transition-none ${
          started ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* ...地圖與狀態列 */}
      </section>

      {/* 右欄：物件，Task 5 */}
    </main>
  )
```

**入口不卸載，只是淡出。** 用 `started ? null : <Entrance/>` 會讓輸入中的文字與焦點消失。

**順手補上 `data-testid="chat-messages"`。** 這個 testid 原本在 `components/Chat/ChatPanel.tsx`，
隨 Task 1 一起刪掉了，但 Task 6 的行動版測試要用它。加在 `AgentApp` 左欄那個包住訊息串的
`<div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">` 上。

**地圖區塊不得掛條件渲染。** `MapView` 一旦重新掛載就會重抓圖磚。它必須從第一次 render 就在樹上，只是被 `translate-x-full` 推到畫面外。

- [ ] **Step 3: 手動驗證**

```bash
pnpm dev
```
確認：
- 初始為置中入口，placeholder 每 4.5 秒換一句
- 點例句 chip → 入口淡出上移、地圖從右滑入，**沒有閃白**
- 送出後把輸入框的文字先打一半再送出，確認畫面切換後輸入框仍在（Task 6 會把這點變成測試）

若無法驅動瀏覽器，誠實說明，不要宣稱看過。

- [ ] **Step 4: 驗證與 Commit**

```bash
pnpm test && pnpm exec tsc --noEmit && pnpm build
git add -A
git commit -m "feat(ui): 置中入口與地圖滑入轉場"
```

---

### Task 4: 選取狀態、浮動卡片、放大置中

這個 task 是本次改版的核心互動，也是最容易做成「看起來對但不常駐」的一段。

**Files:**
- Create: `components/MapView/MapCard.tsx`
- Modify: `components/MapView/MapView.tsx`
- Modify: `components/AgentApp/AgentApp.tsx`

**Interfaces:**
- Consumes: `ScoredListing`、`formatPrice` / `formatArea` / `formatDistance` / `formatCommute`
- Produces:
  - `MapView` props 新增 `selectedId: string | null`
  - `<MapCard listing x y flip onClose />`

- [ ] **Step 1: 在 `AgentApp` 加入 `selectedId`**

```ts
const [selectedId, setSelectedId] = useState<string | null>(null)
```

**必須與 `s.hoveredId` 分開。** 共用一個的話，點選後滑鼠一移開卡片就消失 —— 常駐失效。

`MapView` 的 `onSelect` 由目前的 `s.setHoveredId` 改為 `setSelectedId`。
`ListingList` 的卡片點擊同樣呼叫 `setSelectedId`。

結果變動時清除選取（選中的物件可能已不在新結果裡）：
```ts
useEffect(() => { setSelectedId(null) }, [s.results])
```

- [ ] **Step 2: `MapView` 接受 `selectedId` 並回報螢幕座標**

`Props` 新增：
```ts
  selectedId: string | null
```

`MapView` 目前只 import `useEffect, useRef`。下面的錨點狀態需要 `useState`：
```ts
import { useEffect, useRef, useState } from 'react'
```

新增一個 effect：選取變動時 `flyTo`，並持續回報該點的螢幕座標給浮動卡片。

```tsx
  // 選取 → 放大置中
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedId) return
    const target = results.find((r) => r.id === selectedId)
    if (!target) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const options = { center: [target.lng, target.lat] as [number, number], zoom: 15 }
    if (reduced) map.jumpTo(options)
    else map.flyTo({ ...options, duration: 600 })
  }, [selectedId, results])

  // 卡片錨點：相機一動就重算螢幕座標
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const map = mapRef.current
    const shownId = selectedId ?? hoveredId
    if (!map || !shownId) { setAnchor(null); return }
    const target = results.find((r) => r.id === shownId)
    if (!target) { setAnchor(null); return }

    let frame = 0
    const update = () => {
      frame = 0
      const p = map.project([target.lng, target.lat])
      setAnchor({ x: p.x, y: p.y })
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }

    update()
    map.on('move', schedule)
    map.on('zoom', schedule)
    map.on('resize', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      map.off('move', schedule)
      map.off('zoom', schedule)
      map.off('resize', schedule)
    }
  }, [selectedId, hoveredId, results])
```

**必須用 `requestAnimationFrame` 節流。** `move` 在拖曳時每幀觸發，直接 `setState` 會抖動並掉幀。

- [ ] **Step 3: 浮動卡片元件**

`components/MapView/MapCard.tsx`:
```tsx
import { formatArea, formatCommute, formatDistance, formatPrice } from '@/lib/client/format'
import type { ScoredListing } from '@/lib/types/listing'

interface Props {
  listing: ScoredListing
  x: number
  y: number
  /** true 時卡片開在圖示左側（圖示太靠右） */
  flipX: boolean
  /** true 時卡片往上開（圖示太靠下） */
  flipY: boolean
  pinned: boolean
  onClose: () => void
}

const CARD_W = 240
const CARD_H = 150
const GAP = 14

export function MapCard({ listing, x, y, flipX, flipY, pinned, onClose }: Props) {
  const f = listing.features
  return (
    <div
      data-testid="map-card"
      style={{
        left: flipX ? x - CARD_W - GAP : x + GAP,
        top: flipY ? y - CARD_H - GAP : y - CARD_H / 2,
        width: CARD_W,
      }}
      className="pointer-events-auto absolute z-30 rounded-xl border border-neutral-200 bg-white p-3 shadow-lg"
    >
      {pinned && (
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉"
          className="absolute right-2 top-2 text-neutral-400 transition hover:text-neutral-900"
        >
          ✕
        </button>
      )}
      <p className="text-[11px] text-neutral-500">{listing.city}{listing.district}</p>
      <p className="mt-0.5 truncate pr-4 text-sm font-semibold text-neutral-900">{listing.title}</p>
      <p className="mt-1 text-base font-bold text-neutral-900">{formatPrice(listing)}</p>
      <p className="text-xs text-neutral-600">
        {formatArea(listing.area)}・{listing.layout}・屋齡 {listing.age.toFixed(0)} 年
      </p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 text-[11px] text-neutral-600">
        <div><dt className="inline text-neutral-400">捷運 </dt><dd className="inline">{formatDistance(f.distToMetro)}</dd></div>
        <div><dt className="inline text-neutral-400">通勤 </dt><dd className="inline">{formatCommute(f.commuteToCbdMin)}</dd></div>
      </dl>
    </div>
  )
}
```

- [ ] **Step 4: 在 `MapView` 掛上卡片與翻轉判斷**

`MapView` 的 return 改為：
```tsx
  const shown = results.find((r) => r.id === (selectedId ?? hoveredId)) ?? null

  return (
    <div ref={containerRef} className="relative h-full w-full bg-neutral-200" data-testid="map">
      {shown && anchor && (
        <MapCard
          listing={shown}
          x={anchor.x}
          y={anchor.y}
          flipX={anchor.x > (containerRef.current?.clientWidth ?? 0) - 280}
          flipY={anchor.y > (containerRef.current?.clientHeight ?? 0) - 170}
          pinned={shown.id === selectedId}
          onClose={() => onSelect(null)}
        />
      )}
    </div>
  )
```

`onSelect` 的型別隨之改為 `(id: string | null) => void`。

**邊緣翻轉不能省。** 沒有它，選到地圖右緣或下緣的物件，卡片會有一半在畫面外。

- [ ] **Step 5: 點地圖空白處與 ESC 清除選取**

在 `MapView` 的初始化 effect 內加上：
```ts
    map.on('click', () => onSelectRef.current(null))
```
Marker 的 click handler 已經 `stopPropagation` 了嗎？沒有的話要加，否則點 marker 會同時觸發地圖的 click 而立刻取消選取：
```ts
      el.addEventListener('click', (event) => {
        event.stopPropagation()
        onSelectRef.current(r.id)
      })
```

ESC 在 `AgentApp` 處理：
```ts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
```

- [ ] **Step 6: 手動驗證**

- hover 圖示 → 卡片浮現在旁邊，移開消失
- 點圖示 → 地圖放大置中，卡片帶 ✕ 且**滑鼠移開後仍在**
- 拖曳地圖 → 卡片跟著圖示移動且不抖
- 選地圖最右邊的物件 → 卡片翻到左側
- 按 ESC 或點空白 → 卡片消失

- [ ] **Step 7: 驗證與 Commit**

```bash
pnpm test && pnpm exec tsc --noEmit && pnpm build
git add -A
git commit -m "feat(map): 選取鎖定、浮動卡片與放大置中"
```

---

### Task 5: 權重浮動面板與可收納物件欄

**Files:**
- Create: `components/WeightPanel/WeightPopover.tsx`
- Create: `components/ListingList/ListingList.tsx`
- Delete: `components/ListingCard/ResultStrip.tsx`
- Modify: `components/WeightPanel/WeightPanel.tsx`（只換徽章顏色）
- Modify: `components/AgentApp/AgentApp.tsx`

**Interfaces:**
- Produces:
  - `<WeightPopover profile onChange highlighted />`
  - `<ListingList results hoveredId selectedId onHover onSelect open onToggle />`

- [ ] **Step 1: 把 `WeightPanel` 最後一處藍色換掉**

`components/WeightPanel/WeightPanel.tsx` 第 47 行附近，agent 調整權重時的 `50 → 70` 徽章：

```
bg-blue-50 → bg-neutral-900
text-blue-700 → text-white
ring-1 ring-inset ring-blue-200 → （移除 ring）
```

其餘一律不動 —— 七條 slider、`aria-label` 在 `Slider.Thumb`、`data-testid="weight-panel"` 全部保留。

- [ ] **Step 2: 浮動面板**

`components/WeightPanel/WeightPopover.tsx`:
```tsx
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
        <div className="absolute bottom-full left-0 z-40 mb-2 w-80 rounded-xl border border-neutral-200 bg-white shadow-xl">
          <WeightPanel profile={profile} onChange={onChange} highlighted={highlighted} />
        </div>
      )}
    </div>
  )
}
```

**不加 backdrop。** 這個面板的價值就是拖動時看著地圖與卡片即時重排；遮罩會遮住該看的東西。

**用 `mousedown` 而非 `click` 判斷外部點擊** —— slider 拖曳時若在面板外放開滑鼠，`click` 事件的 target 會是面板外，面板會在拖到一半時自己關掉。

- [ ] **Step 3: 直向可收納物件欄**

`components/ListingList/ListingList.tsx`:
```tsx
'use client'

import { ListingCard } from '@/components/ListingCard/ListingCard'
import type { ScoredListing } from '@/lib/types/listing'

interface Props {
  results: ScoredListing[]
  hoveredId: string | null
  selectedId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
  open: boolean
  onToggle: () => void
}

export function ListingList({ results, hoveredId, selectedId, onHover, onSelect, open, onToggle }: Props) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        data-testid="listing-list-toggle"
        aria-label="展開物件列表"
        className="flex w-10 shrink-0 flex-col items-center gap-2 border-l border-neutral-200 bg-white py-3 text-neutral-500 transition hover:text-neutral-900"
      >
        <span aria-hidden>◀</span>
        <span className="text-[11px] tabular-nums [writing-mode:vertical-rl]">{results.length} 筆</span>
      </button>
    )
  }

  return (
    <aside
      data-testid="listing-list"
      className="flex w-80 shrink-0 flex-col border-l border-neutral-200 bg-neutral-50"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-3 py-2">
        <span className="text-xs text-neutral-500">
          <span className="font-medium tabular-nums text-neutral-900">{results.length}</span> 筆物件
        </span>
        <button
          type="button"
          onClick={onToggle}
          data-testid="listing-list-toggle"
          aria-label="收合物件列表"
          className="text-neutral-400 transition hover:text-neutral-900"
        >
          ▶
        </button>
      </div>

      {results.length === 0 ? (
        <p className="p-4 text-sm text-neutral-500">還沒有結果。描述一下你想要的生活，或直接調整權重。</p>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {results.map((r, i) => (
            <div key={r.id} onClick={() => onSelect(r.id)} className="cursor-pointer">
              <ListingCard
                listing={r}
                rank={i + 1}
                hovered={r.id === hoveredId || r.id === selectedId}
                onHover={onHover}
              />
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
```

收納後保留筆數，不整個換成浮鈕 —— 使用者才不會忘記它存在。

- [ ] **Step 4: 接進 `AgentApp` 並刪除 `ResultStrip`**

`AgentApp` 新增：
```ts
const [panelOpen, setPanelOpen] = useState(false)
const [listOpen, setListOpen] = useState(true)
```

左欄底部原本那塊 `max-h-[42%] overflow-y-auto` 包著 `WeightPanel` 的區塊整個移除，
換成一行 `WeightPopover`，放在輸入表單**上方**（浮層是 `bottom-full` 向上開，放下方會被視窗底部裁掉）：

```tsx
        <div className="shrink-0 border-t border-neutral-200 px-3 py-2">
          <WeightPopover
            profile={s.profile}
            onChange={s.setProfile}
            highlighted={highlighted}
            open={panelOpen}
            onOpenChange={setPanelOpen}
          />
        </div>
```

右欄改掛 `ListingList`，地圖下方那塊 `ResultStrip` 整個移除。

```bash
git rm components/ListingCard/ResultStrip.tsx
```

- [ ] **Step 5: 驗證與 Commit**

```bash
pnpm test && pnpm exec tsc --noEmit && pnpm build
git add -A
git commit -m "feat(ui): 權重浮動面板與可收納物件欄"
```

---

### Task 6: 行動版與端對端測試

**Files:**
- Modify: `components/AgentApp/AgentApp.tsx`（行動版分頁）
- Modify: `e2e/smoke.spec.ts`（重建）

- [ ] **Step 1: 行動版分頁**

`md`（768px）以下改單欄 + 分頁。`AgentApp` 新增：
```ts
const [mobileTab, setMobileTab] = useState<'chat' | 'map' | 'list'>('chat')
```

送出第一則訊息時自動切到地圖：在 `send()` 開頭加 `setMobileTab('map')`。

分頁列只在 `started && md 以下` 顯示：
```tsx
      {started && (
        <nav className="absolute inset-x-0 top-0 z-30 flex border-b border-neutral-200 bg-white md:hidden" aria-label="檢視切換">
          {([['chat', '對話'], ['map', '地圖'], ['list', '物件']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMobileTab(key)}
              aria-pressed={mobileTab === key}
              className={`flex-1 py-2 text-sm font-medium ${
                mobileTab === key ? 'border-b-2 border-neutral-900 text-neutral-900' : 'text-neutral-400'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
```

三欄各自加上行動版顯示條件（`md:flex` 搭配 `mobileTab` 判斷），桌面版行為完全不變。

浮動權重面板在 `md` 以下改為由下方滑入的半屏面板：`WeightPopover` 的浮層 class 加上 `max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:w-full max-md:rounded-b-none`。錨定式浮層在窄螢幕會超出邊界。

- [ ] **Step 2: 重建 e2e**

`e2e/smoke.spec.ts` 全檔替換：

```ts
import { expect, test } from '@playwright/test'

/**
 * 這些測試不依賴 Fastify 後端。後端未啟動時 /api/agent/chat 會回錯誤，
 * UI 顯示 ⚠️ 訊息但版面轉場、權重面板、物件欄仍照常運作 —— 那正是這裡要測的。
 */

test('初始畫面顯示置中入口', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('entrance')).toBeVisible()
  await expect(page.getByTestId('composer-input')).toBeVisible()
  await expect(page.getByRole('button', { name: '買房' })).toBeVisible()
})

test('送出後入口淡出、地圖出現', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()

  await expect(page.getByTestId('map')).toBeVisible()
  await expect(page.getByTestId('entrance')).not.toBeVisible()
})

test('送出後輸入框仍存在——入口沒有被重新掛載', async ({ page }) => {
  await page.goto('/')
  const input = page.getByTestId('composer-input')
  await input.fill('台北的房子')
  await page.getByTestId('composer-submit').click()
  await expect(page.getByTestId('map')).toBeVisible()

  // 入口淡出但仍在 DOM 裡；若被卸載，count 會是 0
  await expect(input).toHaveCount(1)
})

test('修改權重開關浮動面板，七條 slider 都在', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()

  await expect(page.getByTestId('weight-panel')).toBeHidden()
  await page.getByTestId('weight-trigger').click()
  await expect(page.getByTestId('weight-panel')).toBeVisible()

  for (const label of ['房價可負擔', '同區性價比', '天氣環境', '地理位置', '生活機能', '坪數格局', '屋況條件']) {
    await expect(page.getByRole('slider', { name: label })).toHaveAttribute('aria-valuenow', '50')
  }

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('weight-panel')).toBeHidden()
})

test('物件欄可收納，收合後仍看得到筆數', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()
  await expect(page.getByTestId('listing-list')).toBeVisible()

  await page.getByTestId('listing-list-toggle').click()
  await expect(page.getByTestId('listing-list')).toBeHidden()
  await expect(page.getByTestId('listing-list-toggle')).toContainText('筆')

  await page.getByTestId('listing-list-toggle').click()
  await expect(page.getByTestId('listing-list')).toBeVisible()
})

test('手機版以分頁切換', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()

  await expect(page.getByTestId('map')).toBeVisible()
  await page.getByRole('button', { name: '對話' }).click()
  await expect(page.getByTestId('chat-messages')).toBeVisible()
})
```

**關於「點圖示後卡片常駐」這個測試：** 它需要地圖上真的有 marker，而 marker 來自排序結果，結果來自 `/api/rank`（純 scoring，不需 Fastify）。若送出後 `listing-card` 有內容，就代表有 marker。此時再補一個測試：

```ts
test('點物件卡片後移開滑鼠，浮動卡片仍在——選取與 hover 是兩個狀態', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()
  await expect(page.getByTestId('listing-card').first()).toBeVisible()

  await page.getByTestId('listing-card').first().click()
  await expect(page.getByTestId('map-card')).toBeVisible()

  // 把滑鼠移到完全無關的位置；hover 態會消失，選取態不該消失
  await page.mouse.move(5, 5)
  await expect(page.getByTestId('map-card')).toBeVisible()
})
```

這是唯一能抓到「常駐失效」的測試。若它失敗，代表 `selectedId` 與 `hoveredId` 在某處被混用了 —— 去修那個，不要放寬斷言。

- [ ] **Step 3: 全套驗證**

```bash
lsof -ti:3000 | xargs -r kill   # 這個分支曾多次遺留 dev server
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm e2e
```
Expected: 全部通過。

若某個 e2e 因為結果為空而失敗（`/api/rank` 需要 `data/app.db`），先跑 `pnpm db:push && pnpm db:seed`。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): 行動版分頁與端對端測試重建"
```

---

## 完成後的狀態

- `/` 為地圖優先介面：置中入口 → 地圖滑入 → 三欄
- 權重面板浮動、不阻擋，拖動時看得到地圖與卡片即時重排
- 物件欄可收納，收合後仍顯示筆數
- 圖示 hover 預覽、點選鎖定並放大置中，卡片跟隨圖示且會邊緣翻轉
- Gemini 路徑與 `/classic` 已移除
- `AgentApp` 的串流解析改用有 6 個測試覆蓋的 `parseSseChunk`

## 已知限制

- 地圖沒有 cluster。30 筆以內用 DOM Marker 足夠；換成真實資料前必須先解決 maplibre worker 在此環境被關掉的問題
- e2e 不依賴 Fastify 後端。agent 對話的實際品質（行政區選得對不對）不在自動化覆蓋範圍
