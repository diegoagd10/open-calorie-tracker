import { loginResponseSchema, loginSchema } from '@open-calorie-tracker/shared'
import { decodeJwt } from 'jose'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { API_URL } from '@/lib/api'
import { ACCESS_TOKEN_COOKIE } from '@/lib/session'

// API statuses the form knows how to explain; anything else is reported as a generic failure.
const FORWARDED_STATUSES = new Set([400, 401, 423, 429])

const status = (code: number) => new Response(null, { status: code })

export async function POST(request: NextRequest) {
  const input = loginSchema.safeParse(await request.json().catch(() => undefined))
  if (!input.success) return status(400)

  let upstream: Response
  try {
    upstream = await fetch(`${API_URL}/v1/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Lockout and rate limiting are per client IP, not per Next.js server.
        'X-Forwarded-For': request.headers.get('x-forwarded-for') ?? '',
      },
      body: JSON.stringify(input.data),
      cache: 'no-store',
    })
  } catch {
    return status(502)
  }

  if (FORWARDED_STATUSES.has(upstream.status)) return status(upstream.status)
  if (!upstream.ok) return status(502)

  const body = loginResponseSchema.safeParse(await upstream.json().catch(() => undefined))
  if (!body.success) return status(502)

  const { accessToken } = body.data
  const expiresAt = decodeJwt(accessToken).exp ?? 0
  ;(await cookies()).set(ACCESS_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
  })

  return status(204)
}
