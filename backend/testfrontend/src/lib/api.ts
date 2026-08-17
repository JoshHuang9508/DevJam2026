import type { BackendHealth, SearchSession } from "./types";

export const BACKEND_PREFIX = import.meta.env.VITE_BACKEND_URL || "/backend";

export class BackendError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "BackendError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND_PREFIX}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new BackendError(503, `無法連線後端 ${BACKEND_PREFIX}，請確認 backend 的 pnpm dev 有在跑`);
  }
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const detail = body as { message?: string } | null;
    throw new BackendError(response.status, detail?.message ?? response.statusText);
  }
  return body as T;
}

export function getHealth(): Promise<BackendHealth> {
  return call<BackendHealth>("/health");
}

export function createSession(): Promise<SearchSession> {
  return call<SearchSession>("/sessions", { method: "POST", body: "{}" });
}

export function getSession(id: string): Promise<SearchSession> {
  return call<SearchSession>(`/sessions/${id}`);
}

export async function openMessageStream(id: string, message: string, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND_PREFIX}/sessions/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ message }),
      signal,
    });
  } catch {
    throw new BackendError(503, `無法連線後端 ${BACKEND_PREFIX}，請確認 backend 的 pnpm dev 有在跑`);
  }
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new BackendError(response.status, detail || response.statusText);
  }
  return response;
}
