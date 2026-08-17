import 'server-only'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'

const gzipAsync = promisify(gzip)

/**
 * 會壓縮的 JSON 回應。
 *
 * 為什麼要自己做：Next 的 `compress: true` 只作用在頁面與靜態資源，**App Router 的
 * route handler 不會被壓到**。實測 `/api/rank` 回 480 KB 時，回應標頭連
 * `Content-Encoding` 與 `Vary: Accept-Encoding` 都沒有，而同一台伺服器的首頁 HTML
 * 有 `Content-Encoding: gzip`。
 *
 * 用非同步的 gzip 而不是 gzipSync：480 KB 同步壓縮會把 event loop 卡住十幾毫秒，
 * 正式機只有 2 vCPU，同時有人在跑 agent 對話時那段停頓會被感覺到。
 */
const MIN_BYTES = 1024

export async function compressedJson(
  data: unknown,
  request: Request,
  init: ResponseInit = {},
): Promise<Response> {
  const body = JSON.stringify(data)
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  // 一定要帶：沒有這個，中間的快取可能把壓縮過的回應餵給不支援的客戶端
  headers.set('vary', 'accept-encoding')

  const accepts = request.headers.get('accept-encoding') ?? ''
  // 小回應壓了反而更大，而且省不到什麼
  if (body.length < MIN_BYTES || !/\bgzip\b/.test(accepts)) {
    return new Response(body, { ...init, headers })
  }

  const compressed = await gzipAsync(body)
  headers.set('content-encoding', 'gzip')
  headers.set('content-length', String(compressed.byteLength))
  return new Response(compressed as unknown as BodyInit, { ...init, headers })
}
