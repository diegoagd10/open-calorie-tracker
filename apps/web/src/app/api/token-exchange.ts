import { loginResponseSchema } from '@open-calorie-tracker/shared'
import type { NextRequest } from 'next/server'
import { startSession } from '@/lib/session'
import { relay, status } from './relay'

export const clientIp = (request: NextRequest) => request.headers.get('x-forwarded-for') ?? ''

// Sends the request to an API endpoint that answers with an access token, and stores that token
// in the session cookie. Statuses the form knows how to explain are forwarded; anything else is
// reported as a generic failure.
export const exchangeForSession = (
  send: () => Promise<Response>,
  forwardedStatuses: ReadonlySet<number>,
): Promise<Response> =>
  relay(send, forwardedStatuses, async (upstream) => {
    const token = loginResponseSchema.safeParse(await upstream.json().catch(() => undefined))
    if (!token.success) return status(502)

    await startSession(token.data.accessToken)
    return status(204)
  })
