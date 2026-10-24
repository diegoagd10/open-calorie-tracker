import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { API_URL } from '@/lib/api'
import { ACCESS_TOKEN_COOKIE } from '@/lib/session'

// API statuses the page knows how to handle; anything else is reported as a generic failure.
const FORWARDED_STATUSES = new Set([400, 401])

const status = (code: number) => new Response(null, { status: code })

export async function GET(request: NextRequest) {
  const token = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value
  if (token === undefined) return status(401)

  const { searchParams } = request.nextUrl
  const query = new URLSearchParams({
    date: searchParams.get('date') ?? '',
    timeZone: searchParams.get('timeZone') ?? '',
  })

  let upstream: Response
  try {
    upstream = await fetch(`${API_URL}/v1/daily-log?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  } catch {
    return status(502)
  }

  if (FORWARDED_STATUSES.has(upstream.status)) return status(upstream.status)
  if (!upstream.ok) return status(502)

  const body: unknown = await upstream.json().catch(() => undefined)
  if (body === undefined) return status(502)
  return Response.json(body)
}
