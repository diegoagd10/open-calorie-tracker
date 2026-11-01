export const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'

type SendOptions = { body?: unknown; headers?: Record<string, string> }

// Every call to the API goes through here: JSON bodies, never cached.
export const send = (method: string, path: string, { body, headers = {} }: SendOptions = {}) =>
  fetch(`${apiUrl}${path}`, {
    method,
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  })

export const get = (path: string, headers: Record<string, string> = {}) =>
  send('GET', path, { headers })

// `clientIp` is forwarded because lockout and rate limiting are per client IP, not per
// Next.js server.
export const post = (path: string, body: unknown, clientIp: string) =>
  send('POST', path, { body, headers: { 'X-Forwarded-For': clientIp } })

// Authenticates a call made on the user's behalf with the access token the API signed.
export const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` })
