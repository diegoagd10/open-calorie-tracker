import type { NextRequest } from 'next/server'
import { sessionToken } from '@/lib/session'

export const status = (code: number) => new Response(null, { status: code })

// The JSON body the page sent, or undefined when it sent none or not JSON.
export const jsonBody = (request: NextRequest): Promise<unknown> =>
  request.json().catch(() => undefined)

// Sends a request to the API and answers the page. Statuses the page knows how to explain are
// forwarded; any other failure, including an unreachable API, is reported as a generic failure
// (502). A successful answer goes to onSuccess.
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

// Invalid input, an expired session and a missing record: the page handles each of them.
const SESSION_FORWARDED_STATUSES = new Set([400, 401, 404])

// Passes the API's answer on: its JSON body with its status, or no body for 204.
const passOn = async (upstream: Response) => {
  if (upstream.status === 204) return status(204)
  const body: unknown = await upstream.json().catch(() => undefined)
  return body === undefined ? status(502) : Response.json(body, { status: upstream.status })
}

// Relays a call the API authenticates with the session token. Without a session the page gets
// 401 and the API is not called. `alsoForwarded` adds statuses a page explains on its own.
export const relayWithSession = async (
  send: (token: string) => Promise<Response>,
  alsoForwarded: readonly number[] = [],
) => {
  const token = await sessionToken()
  if (token === undefined) return status(401)
  const forwarded = new Set([...SESSION_FORWARDED_STATUSES, ...alsoForwarded])
  return relay(() => send(token), forwarded, passOn)
}
