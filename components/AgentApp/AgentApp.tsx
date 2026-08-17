'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ResultStrip } from '@/components/ListingCard/ResultStrip'
import { MapView } from '@/components/MapView/MapView'
import { ModeToggle } from '@/components/ModeToggle/ModeToggle'
import { WeightPanel } from '@/components/WeightPanel/WeightPanel'
import { useDebouncedEffect } from '@/hooks/useDebouncedEffect'
import { useSearchState } from '@/hooks/useSearchState'
import { weightDiff } from '@/lib/backend/profile-bridge'
import type { Candidate } from '@/lib/backend/types'
import { PLACEHOLDERS } from '@/lib/client/placeholders'
import { parseSseChunk } from '@/lib/client/sseClient'
import { parseProfile } from '@/lib/profile/schema'
import type { ChatMessage } from '@/lib/types/chat'
import type { RankResult, ScoredListing } from '@/lib/types/listing'
import type { Mode, SearchProfile, WeightKey } from '@/lib/types/profile'
import { DistrictStrip } from '@/components/AgentApp/DistrictStrip'
import { Entrance } from '@/components/AgentApp/Entrance'

const RANK_DEBOUNCE_MS = 200
const SESSION_KEY = 'selector.sessionId'

interface Status {
  backendUp: boolean
  agentRuntime: string | null
  listingsDb: boolean
}

export function AgentApp() {
  const s = useSearchState()
  const [status, setStatus] = useState<Status | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [districts, setDistricts] = useState<Candidate[]>([])
  const [highlighted, setHighlighted] = useState<Partial<Record<WeightKey, { from: number; to: number }>>>({})
  const [input, setInput] = useState('')
  const [chatting, setChatting] = useState(false)

  const profileRef = useRef<SearchProfile>(s.profile)
  profileRef.current = s.profile
  // Suppresses the debounced /api/rank right after a chat turn already set results.
  const skipNextRank = useRef(false)
  const chatBottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void fetch('/api/agent/session')
      .then((r) => r.json() as Promise<Status>)
      .then(setStatus)
      .catch(() => setStatus({ backendUp: false, agentRuntime: null, listingsDb: false }))
  }, [])

  useEffect(() => { chatBottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Slider / mode path: pure scoring engine, no backend and no model call.
  useDebouncedEffect(() => {
    if (skipNextRank.current) { skipNextRank.current = false; return }
    void s.rank(s.profile)
  }, [s.profile], RANK_DEBOUNCE_MS)

  const setMode = (mode: Mode) => {
    const { budgetMin: _min, budgetMax: _max, ...hard } = s.profile.hard
    s.setProfile({ ...s.profile, mode, hard })
  }

  const send = useCallback(async (text: string) => {
    const message = text.trim()
    if (!message || chatting) return
    const turn = `${Date.now()}`
    setInput('')
    setChatting(true)
    setHighlighted({})
    setMessages((prev) => [
      ...prev,
      { id: `u-${turn}`, role: 'user', content: message },
      { id: `a-${turn}`, role: 'assistant', content: '', streaming: true },
    ])

    const appendText = (delta: string) => setMessages((prev) => prev.map((m) =>
      m.id === `a-${turn}` ? { ...m, content: m.content + delta } : m))

    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: window.localStorage.getItem(SESSION_KEY) ?? undefined,
          profile: profileRef.current,
          message,
        }),
      })
      if (!response.body) throw new Error('後端沒有回傳串流')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = parseSseChunk(buffer)
        buffer = rest

        for (const { event: name, data } of events) {
          switch (name) {
            case 'session':
              window.localStorage.setItem(SESSION_KEY, (data as { sessionId: string }).sessionId)
              break
            case 'districts':
              setDistricts(data as Candidate[])
              break
            case 'profile': {
              const next = parseProfile(data)
              setHighlighted(weightDiff(profileRef.current, next))
              // The server already ranked with this profile; don't re-rank on echo.
              skipNextRank.current = true
              s.setProfile(next)
              break
            }
            case 'results': {
              const result = data as RankResult
              s.setResults(result.results as ScoredListing[])
              s.setRelaxations(result.relaxations)
              break
            }
            case 'text':
              appendText((data as { delta: string }).delta)
              break
            case 'error':
              appendText(`\n\n⚠️ ${(data as { message: string }).message}`)
              break
            default:
              break
          }
        }
      }
    } catch (cause) {
      appendText(`\n\n⚠️ ${cause instanceof Error ? cause.message : '對話失敗'}`)
    } finally {
      setMessages((prev) => prev.map((m) =>
        m.id === `a-${turn}` && m.streaming
          ? { ...m, streaming: false, content: m.content || '（這一輪沒有產生回覆）' }
          : m))
      setChatting(false)
      window.setTimeout(() => setHighlighted({}), 4000)
    }
  }, [chatting, s])

  const runtimeLabel = status === null
    ? '檢查中…'
    : !status.backendUp ? '後端未連線'
    : status.agentRuntime === 'pi-agent-core' ? 'pi-agent-core（LLM）'
    : `${status.agentRuntime}（規則式）`

  const started = messages.length > 0

  return (
    <main className="relative flex h-screen overflow-hidden bg-neutral-50">
      {/* 入口：未開始時置中；開始後淡出並上移，不卸載。inert 移出無障礙樹並擋掉焦點/互動，
          aria-hidden 是 Playwright role 引擎實際讀取的屬性（inert 隱含 aria-hidden 但 Playwright
          未實作這個推論）。兩者缺一都會讓開始後畫面上同時有兩個可被選取到的「買房」按鈕。 */}
      <div
        inert={started}
        aria-hidden={started}
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

      {/* 入口是不透明的 absolute inset-0，開始前已完全遮住這裡；不需要另外淡入，避免雙重表頭同時可見。
          inert + aria-hidden 理由同上：未開始時把這一側移出無障礙樹（見上方入口區塊的註解）。 */}
      <aside
        inert={!started}
        aria-hidden={!started}
        className="flex w-[380px] shrink-0 flex-col border-r border-neutral-200 bg-white"
      >
        <header className="flex items-center gap-2.5 border-b border-neutral-200 px-4 py-3">
          <h1 className="text-[15px] font-bold tracking-tight text-neutral-900">安家</h1>
          <ModeToggle mode={s.profile.mode} onChange={setMode} />
          <span
            className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] leading-none ${
              status?.backendUp ? 'bg-neutral-100 text-neutral-500' : 'bg-red-50 text-red-700'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status === null ? 'bg-neutral-300' : status.backendUp ? 'bg-emerald-500' : 'bg-red-500'
              }`}
            />
            {runtimeLabel}
          </span>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" data-testid="chat-messages">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-[13px] leading-relaxed text-neutral-500">
                  用一句話描述你想要的生活。agent 會先選出適合的行政區，再從那些區裡挑物件。
                </p>
                {PLACEHOLDERS.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => void send(example)}
                    className="block w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-xs leading-relaxed text-neutral-600 transition hover:border-neutral-900 hover:text-neutral-900"
                  >
                    {example}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[96%]'}>
                <div className={`whitespace-pre-wrap text-[13px] leading-relaxed ${
                  m.role === 'user'
                    ? 'rounded-2xl rounded-br-md bg-neutral-900 px-3 py-2 text-white'
                    : 'text-neutral-700'
                }`}>
                  {m.content}
                  {m.streaming && <span className="ml-0.5 animate-pulse text-neutral-400">▍</span>}
                </div>
              </div>
            ))}
            <div ref={chatBottom} />
          </div>

          <form
            className="flex items-end gap-2 border-t border-neutral-200 px-3 py-2"
            onSubmit={(event) => { event.preventDefault(); void send(input) }}
          >
            <textarea
              rows={2}
              value={input}
              placeholder="例如：中南部，月租最高 18000，希望少雨"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send(input)
                }
              }}
              className="min-h-0 flex-1 resize-none rounded-lg border border-neutral-300 px-2.5 py-1.5 text-[13px] leading-relaxed outline-none transition placeholder:text-neutral-400 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
            />
            <button
              type="submit"
              disabled={chatting || !input.trim()}
              className="rounded-lg bg-neutral-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-neutral-700 disabled:opacity-30 disabled:hover:bg-neutral-900"
            >
              {chatting ? '…' : '送出'}
            </button>
          </form>

          <div className="max-h-[42%] overflow-y-auto border-t border-neutral-200">
            <WeightPanel profile={s.profile} onChange={s.setProfile} highlighted={highlighted} />
          </div>
        </div>
      </aside>

      {/* 中欄：地圖，從右滑入。永遠掛載，避免 MapLibre 重新初始化 */}
      <section
        className={`flex min-w-0 flex-1 flex-col transition-transform duration-[240ms] ease-out motion-reduce:transition-none ${
          started ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <DistrictStrip districts={districts} active={s.profile.hard.districts ?? []} />

        <div className="flex shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2 text-xs">
          <span className="text-neutral-500">
            找到 <span className="font-medium tabular-nums text-neutral-900">{s.results.length}</span> 筆物件
          </span>
          {s.loading && <span className="text-neutral-400">排序中…</span>}
          {s.error && <span className="text-red-600">{s.error}</span>}
          {status && !status.listingsDb && (
            <span className="text-amber-700">物件資料庫未建立，請執行 pnpm db:push &amp;&amp; pnpm db:seed</span>
          )}
        </div>

        {s.relaxations.length > 0 && (
          <p className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            為了找到結果，{s.relaxations.join('、')}
          </p>
        )}

        <div className="min-h-0 flex-1">
          <MapView results={s.results} hoveredId={s.hoveredId} onHover={s.setHoveredId} onSelect={s.setHoveredId} />
        </div>

        {/* 不設固定高：由卡片內容撐開，地圖吃掉剩餘空間。 */}
        <div className="shrink-0 border-t border-neutral-200 bg-neutral-100">
          <ResultStrip results={s.results} hoveredId={s.hoveredId} onHover={s.setHoveredId} />
        </div>
      </section>
    </main>
  )
}
