import type { NextRequest } from 'next/server'
import { sessionToken } from '@/lib/session'

export const status = (code: number) => new Response(null, { status: code })

export const jsonBody = (request: NextRequest): Promise<unknown> =>
  request.json().catch(() => undefined)

export const relay = async (
  send: () => Promise<Response>,
  forwardedStatuses: ReadonlySet<number>,
  onSuccess: (upstream: Response) => Promise<Response>,
): Promise<Response> => {
  let upstream: Response
  try {
    upstream = await send()
  } catch {
    return status(502)
  }

  if (forwardedStatuses.has(upstream.status)) return status(upstream.status)
  if (!upstream.ok) return status(502)
  return onSuccess(upstream)
}

const SESSION_FORWARDED_STATUSES = new Set([400, 401, 404])

const passOn = async (upstream: Response) => {
  if (upstream.status === 204) return status(204)
  const body: unknown = await upstream.json().catch(() => undefined)
  return body === undefined ? status(502) : Response.json(body, { status: upstream.status })
}

export const relayWithSession = async (
  send: (token: string) => Promise<Response>,
  alsoForwarded: readonly number[] = [],
) => {
  const token = await sessionToken()
  if (token === undefined) return status(401)
  const forwarded = new Set([...SESSION_FORWARDED_STATUSES, ...alsoForwarded])
  return relay(() => send(token), forwarded, passOn)
}
