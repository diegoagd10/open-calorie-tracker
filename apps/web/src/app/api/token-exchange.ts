import { loginResponseSchema } from '@open-calorie-tracker/shared'
import type { NextRequest } from 'next/server'
import { startSession } from '@/lib/session'

export const status = (code: number) => new Response(null, { status: code })

export const clientIp = (request: NextRequest) => request.headers.get('x-forwarded-for') ?? ''

// Sends the request to an API endpoint that answers with an access token, and stores that token
// in the session cookie. Statuses the form knows how to explain are forwarded; anything else is
// reported as a generic failure.
export const exchangeForSession = async (
  send: () => Promise<Response>,
  forwardedStatuses: ReadonlySet<number>,
): Promise<Response> => {
  let upstream: Response
  try {
    upstream = await send()
  } catch {
    return status(502)
  }

  if (forwardedStatuses.has(upstream.status)) return status(upstream.status)
  if (!upstream.ok) return status(502)

  const token = loginResponseSchema.safeParse(await upstream.json().catch(() => undefined))
  if (!token.success) return status(502)

  await startSession(token.data.accessToken)
  return status(204)
}
