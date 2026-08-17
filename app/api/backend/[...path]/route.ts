import { BACKEND_URL } from '@/lib/backend/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 推薦後端的全方法透明代理。
 *
 * 前端用 cloudflare tunnel 對外曝露時，只有 Next 這一個 port 出得去，
 * localhost:3001 從外面連不到。把後端掛在同一個 origin 底下，
 * tunnel 一條就能同時帶出前端與後端（含 Swagger UI 與 SSE）。
 *
 *   /api/backend/health                 -> http://127.0.0.1:3001/health
 *   /api/backend/docs                   -> Swagger UI
 *   /api/backend/sessions/<id>/messages -> SSE，逐 token 轉發不緩衝
 *
 * 注意：這條路由沒有任何驗證或速率限制，等於把整個後端公開出去。
 * 因此正式環境預設關閉，需要時才用 ENABLE_BACKEND_PROXY=true 打開。
 * 見 README 的部署警告。
 */

/**
 * dev 預設開啟（tunnel 要用），production 預設關閉。
 * 兩者都可以用 ENABLE_BACKEND_PROXY 明確覆寫。
 */
function proxyEnabled(): boolean {
  const flag = process.env.ENABLE_BACKEND_PROXY
  if (flag !== undefined) return flag === 'true' || flag === '1'
  return process.env.NODE_ENV !== 'production'
}

// hop-by-hop 與長度相關的標頭不能原樣轉發，否則會與實際傳輸不符
const STRIP = new Set([
  'host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'content-length', 'content-encoding',
])

function forwardHeaders(source: Headers): Headers {
  const out = new Headers()
  source.forEach((value, key) => {
    if (!STRIP.has(key.toLowerCase())) out.set(key, value)
  })
  return out
}

async function proxy(request: Request, path: string[]): Promise<Response> {
  if (!proxyEnabled()) {
    return Response.json(
      {
        error: 'PROXY_DISABLED',
        message: '後端代理在正式環境預設關閉。需要時設定 ENABLE_BACKEND_PROXY=true。',
      },
      { status: 404 },
    )
  }

  const incoming = new URL(request.url)
  const target = `${BACKEND_URL}/${path.join('/')}${incoming.search}`

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: forwardHeaders(request.headers),
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
      signal: request.signal,
    })
  } catch (error) {
    return Response.json(
      {
        error: 'BACKEND_UNREACHABLE',
        message: `無法連線到推薦後端 ${BACKEND_URL}，請確認 backend 的 pnpm dev 有在跑`,
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    )
  }

  const headers = forwardHeaders(upstream.headers)
  // SSE 必須逐塊送出，任何一層緩衝都會讓串流看起來卡住
  if (headers.get('content-type')?.includes('text/event-stream')) {
    headers.set('cache-control', 'no-cache, no-transform')
    headers.set('x-accel-buffering', 'no')
  }

  return new Response(upstream.body, { status: upstream.status, headers })
}

type Ctx = { params: Promise<{ path?: string[] }> }
const handler = async (request: Request, ctx: Ctx) =>
  proxy(request, (await ctx.params).path ?? [])

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const HEAD = handler
export const OPTIONS = handler
