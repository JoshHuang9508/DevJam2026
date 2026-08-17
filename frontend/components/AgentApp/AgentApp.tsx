'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ListingDeck } from '@/components/ListingList/ListingDeck'
import { ListingList } from '@/components/ListingList/ListingList'
import { MapView } from '@/components/MapView/MapView'
import { WeightPopover } from '@/components/WeightPanel/WeightPopover'
import { useDebouncedEffect } from '@/hooks/useDebouncedEffect'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useSearchState } from '@/hooks/useSearchState'
import { weightDiff } from '@/lib/backend/profile-bridge'
import { PLACEHOLDERS } from '@/lib/client/placeholders'
import { parseSseChunk } from '@/lib/client/sseClient'
import { parseProfile } from '@/lib/profile/schema'
import type { ChatMessage } from '@/lib/types/chat'
import type { RankResult, ScoredListing } from '@/lib/types/listing'
import type { SearchProfile, WeightKey } from '@/lib/types/profile'
import { Entrance } from '@/components/AgentApp/Entrance'
import { MarkdownMessage } from '@/components/AgentApp/MarkdownMessage'
import { ChatIcon, MapIcon } from '@/components/AgentApp/TabIcons'

const RANK_DEBOUNCE_MS = 200
const SESSION_KEY = 'selector.sessionId'
// 與入口淡出的 transition duration-[240ms] 對齊：opacity 不會往子節點的 computed style
// 傳遞（不像 visibility 會繼承），所以只淡出外層是不夠的——Entrance 自己的 data-testid
// 節點量出來 opacity 仍是 1，Playwright 的 isVisible() 只看目標節點本身加上祖先的
// display/visibility，不管祖先的 opacity，因此仍判定為「visible」。等淡出動畫跑完再
// 補上 invisible（繼承性的 visibility:hidden），讓量測與畫面兩邊都算「看不見」。
const ENTRANCE_FADE_MS = 240

interface Status {
  backendUp: boolean
  agentRuntime: string | null
  listingsDb: boolean
}

export function AgentApp() {
  const s = useSearchState()
  const [status, setStatus] = useState<Status | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [highlighted, setHighlighted] = useState<Partial<Record<WeightKey, { from: number; to: number }>>>({})
  const [input, setInput] = useState('')
  const [chatting, setChatting] = useState(false)
  // hoveredId（滑鼠移開就清）與 selectedId（點選後常駐，直到 ESC / 點空白 / 換結果）分開放，
  // 共用一個的話點選後滑鼠一移開卡片就消失，「常駐」就失效了。
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [listOpen, setListOpen] = useState(true)
  // md（768px）以下改單欄 + 分頁；桌面版忽略這個狀態，三欄照常並排。
  // 物件列表在行動版不是獨立分頁，而是併進地圖下半部的 ListingDeck。
  const [mobileTab, setMobileTab] = useState<'chat' | 'map'>('chat')
  // 淡出動畫跑完才真正隱藏，見 ENTRANCE_FADE_MS 註解
  const [entranceFaded, setEntranceFaded] = useState(false)

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

  // 對話本身沒有落地，重整後畫面一定是空的入口。舊的 sessionId 若留著，後端還記得上一輪的
  // preference，使用者第一句話就會踩到看不見的既有條件。重整＝新 session。
  useEffect(() => { window.localStorage.removeItem(SESSION_KEY) }, [])

  useEffect(() => { chatBottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // 結果變動時清除選取：選中的物件可能已經不在新結果裡了
  useEffect(() => { setSelectedId(null) }, [s.results])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 入口淡出動畫跑完才切到 invisible（見 ENTRANCE_FADE_MS 註解）；還沒開始或還在動畫中都不隱藏。
  useEffect(() => {
    if (messages.length === 0) { setEntranceFaded(false); return }
    const timer = window.setTimeout(() => setEntranceFaded(true), ENTRANCE_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [messages.length])

  // Slider path: pure scoring engine, no backend and no model call.
  // 對話開始前不排序 —— 掛載時就打一次 /api/rank 會在入口後面堆出一份沒人要求的結果，
  // 使用者關掉入口才發現列表已經有東西。
  useDebouncedEffect(() => {
    if (messages.length === 0) return
    if (skipNextRank.current) { skipNextRank.current = false; return }
    void s.rank(s.profile)
  }, [s.profile], RANK_DEBOUNCE_MS)

  const send = useCallback(async (text: string) => {
    const message = text.trim()
    if (!message || chatting) return
    setMobileTab('map')
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
  const isMobile = useIsMobile()

  return (
    <main className={`relative flex h-[100dvh] overflow-hidden bg-neutral-50 md:pb-0 ${started ? 'pb-[calc(3.25rem+env(safe-area-inset-bottom))]' : ''}`}>
      {/* 入口：未開始時置中；開始後淡出並上移，不卸載。inert 移出無障礙樹並擋掉焦點/互動，
          aria-hidden 是 Playwright role 引擎實際讀取的屬性（inert 隱含 aria-hidden 但 Playwright
          未實作這個推論）。兩者缺一都會讓開始後入口的輸入框還能被焦點與選取器抓到。 */}
      <div
        inert={started}
        aria-hidden={started}
        className={`absolute inset-0 z-20 flex items-center justify-center bg-neutral-50 transition-[opacity,transform] duration-[240ms] ease-out motion-reduce:transition-none ${
          started ? 'pointer-events-none -translate-y-4 opacity-0' : 'translate-y-0 opacity-100'
        } ${entranceFaded ? 'invisible' : ''}`}
      >
        <Entrance
          onSubmit={(text) => void send(text)}
          disabled={chatting}
          statusLabel={runtimeLabel}
          statusOk={status?.backendUp ?? false}
        />
      </div>

      {/* 行動版分頁列：只在對話已開始、且螢幕小於 md 時顯示，固定在底部（拇指可及）。
          main 的 pb-12 空出這條的高度，避免蓋住輸入框；三欄在窄螢幕一次只顯示一個，
          由 mobileTab 決定；桌面版（md 以上）三欄照常並排，這裡的狀態完全不影響桌面版。 */}
      {started && (
        <nav
          className="absolute inset-x-0 bottom-0 z-30 flex border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
          aria-label="檢視切換"
        >
          {([['chat', '對話', ChatIcon], ['map', '地圖與物件', MapIcon]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMobileTab(key)}
              aria-pressed={mobileTab === key}
              className={`flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-medium transition ${
                mobileTab === key ? 'border-t-2 border-neutral-900 text-neutral-900' : 'text-neutral-400'
              }`}
            >
              <Icon className="h-[22px] w-[22px]" />
              {label}
            </button>
          ))}
        </nav>
      )}

      {/* 入口是不透明的 absolute inset-0，開始前已完全遮住這裡；不需要另外淡入，避免雙重表頭同時可見。
          inert + aria-hidden 理由同上：未開始時把這一側移出無障礙樹（見上方入口區塊的註解）。 */}
      <aside
        inert={!started}
        aria-hidden={!started}
        className={`${mobileTab === 'chat' ? 'flex' : 'hidden'} w-full shrink-0 flex-col border-r border-neutral-200 bg-white md:flex md:w-[380px]`}
      >
        <header className="flex items-center gap-2.5 border-b border-neutral-200 px-4 py-3">
          <h1 className="text-[15px] font-bold tracking-tight text-neutral-900">安家</h1>
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
                {m.role === 'user' ? (
                  <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-neutral-900 px-3 py-2 text-[13px] leading-relaxed text-white">
                    {m.content}
                  </div>
                ) : (
                  <MarkdownMessage streaming={m.streaming}>{m.content}</MarkdownMessage>
                )}
              </div>
            ))}
            <div ref={chatBottom} />
          </div>

          {/* 浮層向上開（bottom-full），要放在輸入表單上方——放下方會被視窗底部裁掉 */}
          <div className="shrink-0 border-neutral-200 px-3 pt-2">
            <WeightPopover
              profile={s.profile}
              onChange={s.setProfile}
              highlighted={highlighted}
              open={panelOpen}
              onOpenChange={setPanelOpen}
            />
          </div>

          <form
            className="flex items-stretch gap-2 border-neutral-200 p-3"
            onSubmit={(event) => { event.preventDefault(); void send(input) }}
          >
            <textarea
              rows={2}
              value={input}
              placeholder="例如：中南部，月租最高 18000，希望少雨"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                // 中文／日文輸入法用 Enter 確認選字，那一下也會觸發 keydown。isComposing 為 true
                // 代表這個 Enter 屬於輸入法，不是使用者要送出 —— 不擋就會把只打了一半的句子送出去。
                // keyCode 229 是部分輸入法在組字中回報的「處理中」鍵碼，補一層舊瀏覽器的保險。
                if (event.nativeEvent.isComposing || event.keyCode === 229) return
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
              className="shrink-0 rounded-lg bg-neutral-900 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-700 disabled:opacity-30 disabled:hover:bg-neutral-900"
            >
              {chatting ? '…' : '送出'}
            </button>
          </form>
        </div>
      </aside>

      {/* 中欄：地圖，從右滑入。永遠掛載，避免 MapLibre 重新初始化；
          行動版只用 display 切換分頁，不影響掛載狀態。 */}
      <section
        className={`${mobileTab === 'map' ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col transition-transform duration-[240ms] ease-out motion-reduce:transition-none md:flex ${
          started ? 'translate-x-0' : 'translate-x-full'
        }`}
      >

        {/* 三個訊息都沒有時整條不掛載 —— 空的 div 仍有 py-2 與底線，會在地圖上方留一條白帶 */}
        {(s.loading || s.error !== null || (status !== null && !status.listingsDb)) && (
          <div className="flex shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2 text-xs">
            {s.loading && <span className="text-neutral-400">排序中…</span>}
            {s.error && <span className="text-red-600">{s.error}</span>}
            {status && !status.listingsDb && (
              <span className="text-amber-700">物件資料庫未建立，請執行 pnpm db:push &amp;&amp; pnpm db:seed</span>
            )}
          </div>
        )}

        {s.relaxations.length > 0 && (
          <p className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            為了找到結果，{s.relaxations.join('、')}
          </p>
        )}

        <div className="min-h-0 flex-1">
          <MapView
            results={s.results}
            hoveredId={s.hoveredId}
            selectedId={selectedId}
            onHover={s.setHoveredId}
            onSelect={setSelectedId}
            showCard={!isMobile}
            fitToken={s.fitToken}
          />
        </div>

        {/* 行動版把物件併進地圖下半部：左右滑切上下一筆，切換時 selectedId 變動，
            MapView 既有的選取動畫就會把相機帶到那一筆。 */}
        {isMobile && (
          <ListingDeck results={s.results} selectedId={selectedId} onSelect={setSelectedId} />
        )}
      </section>

      {/* 右欄：可收納物件列表，只在桌面版存在（行動版走 ListingDeck）。
          包裝層用 display:contents，讓 ListingList 自己的根節點在桌面版仍直接是
          main 的 flex 子項，版面跟改動前完全一樣。 */}
      <div className="hidden md:contents">
        <ListingList
          results={s.results}
          hoveredId={s.hoveredId}
          selectedId={selectedId}
          onHover={s.setHoveredId}
          onSelect={setSelectedId}
          open={listOpen}
          onToggle={() => setListOpen((v) => !v)}
        />
      </div>
    </main>
  )
}
