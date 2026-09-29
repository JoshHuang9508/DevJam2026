import { BACKEND_URL } from '@/lib/backend/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const response = await fetch(`${BACKEND_URL}/listings/search`, {
      method: 'POST',
      headers: {
        'content-type': request.headers.get('content-type') ?? 'application/json',
      },
      body: await request.text(),
      cache: 'no-store',
      signal: request.signal,
    })

    return new Response(response.body, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') ?? 'application/json',
      },
    })
  } catch {
    return Response.json({ message: '無法連線到推薦後端' }, { status: 502 })
  }
}
