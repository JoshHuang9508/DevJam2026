import 'server-only'
import type {
  BackendHealth,
  Candidate,
  PreferencePatch,
  PreferenceState,
  SearchSession,
} from './types'

/**
 * The Fastify recommendation backend (repo `backend/`). Server-side only —
 * the browser talks to /api/agent/* so there is one origin and no CORS.
 */
export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:3001'

export class BackendError extends Error {
  constructor(readonly status: number, message: string, readonly requestId?: string) {
    super(message)
    this.name = 'BackendError'
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
      cache: 'no-store',
    })
  } catch (cause) {
    throw new BackendError(503, `無法連線到推薦後端 ${BACKEND_URL}，請確認 backend 的 pnpm dev 有在跑`, undefined)
  }
  const text = await response.text()
  const body = text ? (JSON.parse(text) as unknown) : null
  if (!response.ok) {
    const detail = body as { message?: string; requestId?: string } | null
    throw new BackendError(response.status, detail?.message ?? response.statusText, detail?.requestId)
  }
  return body as T
}

export function getHealth(): Promise<BackendHealth> {
  return call<BackendHealth>('/health')
}

export function createSession(): Promise<SearchSession> {
  return call<SearchSession>('/sessions', { method: 'POST', body: '{}' })
}

export function getSession(id: string): Promise<SearchSession> {
  return call<SearchSession>(`/sessions/${id}`)
}

export function patchPreferences(
  id: string,
  patch: PreferencePatch,
): Promise<{ preferences: PreferenceState; candidates: Candidate[] }> {
  return call(`/sessions/${id}/preferences`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export function rank(id: string, refreshData: boolean): Promise<{ candidates: Candidate[] }> {
  return call(`/sessions/${id}/rank`, { method: 'POST', body: JSON.stringify({ refreshData }) })
}

/**
 * Opens the backend's SSE turn. Returns the raw upstream Response so a Route
 * Handler can hand `response.body` straight back to the browser unbuffered.
 */
export async function openMessageStream(id: string, message: string, signal?: AbortSignal): Promise<Response> {
  const response = await fetch(`${BACKEND_URL}/sessions/${id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ message }),
    cache: 'no-store',
    signal,
  })
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    throw new BackendError(response.status, detail || response.statusText)
  }
  return response
}
