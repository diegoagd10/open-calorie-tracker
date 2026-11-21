const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'

type SendOptions = { body?: unknown; headers?: Record<string, string> }

export const send = (method: string, path: string, { body, headers = {} }: SendOptions = {}) =>
  fetch(`${apiUrl}${path}`, {
    method,
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  })

export const get = (path: string, headers: Record<string, string> = {}) =>
  send('GET', path, { headers })

export const post = (path: string, body: unknown, clientIp: string) =>
  send('POST', path, { body, headers: { 'X-Forwarded-For': clientIp } })

export const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` })
