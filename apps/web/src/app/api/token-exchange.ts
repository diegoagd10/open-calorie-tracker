import { loginResponseSchema } from '@open-calorie-tracker/shared'
import type { NextRequest } from 'next/server'
import { startSession } from '@/lib/session'
import { relay, status } from './relay'

export const clientIp = (request: NextRequest) => request.headers.get('x-forwarded-for') ?? ''

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
