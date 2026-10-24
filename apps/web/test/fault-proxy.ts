import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
  request,
} from 'node:http'

export type Fault = { status: number } | { delayMs: number } | 'connection-reset'

const readBody = async (stream: IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

const usernameIn = (body: Buffer): string | undefined => {
  try {
    const { username } = JSON.parse(body.toString()) as { username?: unknown }
    return typeof username === 'string' ? username : undefined
  } catch {
    return undefined
  }
}

// Sits between Next.js and the real API. It forwards everything untouched unless a test asks it
// to fail or to answer slowly through the control endpoints, so tests can exercise backend
// failures without mocks. It also records the requests it receives, e.g. "GET /v1/daily-log?...".
//
// Faults and recorded requests belong to one user, so spec files running in parallel do not
// affect each other. A request belongs to the user named in its body (login) or to the user its
// bearer token was issued to, which the proxy learns from the logins it forwards.
export const startFaultProxy = async (port: number, targetUrl: string): Promise<Server> => {
  const target = new URL(targetUrl)
  const faults = new Map<string, Fault>()
  const requests = new Map<string, string[]>()
  const tokenOwners = new Map<string, string>()

  const handleControl = async (req: IncomingMessage, res: ServerResponse) => {
    const match = /^\/__(faults|requests)\/(.+)$/.exec(req.url ?? '')
    if (match === null) return false
    const [, kind, encodedUser = ''] = match
    const user = decodeURIComponent(encodedUser)

    if (kind === 'faults') {
      if (req.method === 'PUT')
        faults.set(user, JSON.parse((await readBody(req)).toString()) as Fault)
      else faults.delete(user)
      res.writeHead(204).end()
    } else {
      if (req.method === 'DELETE') requests.delete(user)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(requests.get(user) ?? []))
    }
    return true
  }

  const ownerOf = (req: IncomingMessage, body: Buffer) => {
    const authorization = req.headers.authorization
    if (authorization?.startsWith('Bearer ')) return tokenOwners.get(authorization.slice(7))
    return usernameIn(body)
  }

  const respond = async (req: IncomingMessage, res: ServerResponse) => {
    if (await handleControl(req, res)) return

    const body = await readBody(req)
    const user = ownerOf(req, body)
    if (user !== undefined)
      requests.set(user, [...(requests.get(user) ?? []), `${req.method} ${req.url}`])
    const fault = user === undefined ? undefined : faults.get(user)

    if (fault === 'connection-reset') {
      req.socket.destroy()
      return
    }
    if (fault !== undefined && 'status' in fault) {
      res.writeHead(fault.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: 'Injected failure' }))
      return
    }

    const forward = () => {
      const upstream = request(
        {
          hostname: target.hostname,
          port: target.port,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (upstreamRes) => {
          const isLogin = req.method === 'POST' && req.url === '/v1/login'
          if (!isLogin || upstreamRes.statusCode !== 200 || user === undefined) {
            res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
            upstreamRes.pipe(res)
            return
          }
          // Remembers who the token belongs to before passing the login response on.
          void readBody(upstreamRes).then((responseBody) => {
            const { accessToken } = JSON.parse(responseBody.toString()) as { accessToken: string }
            tokenOwners.set(accessToken, user)
            res.writeHead(200, upstreamRes.headers).end(responseBody)
          })
        },
      )
      upstream.on('error', () => res.writeHead(502).end())
      upstream.end(body)
    }

    if (fault !== undefined && 'delayMs' in fault) setTimeout(forward, fault.delayMs)
    else forward()
  }

  const server = createServer((req, res) => void respond(req, res))
  await new Promise<void>((resolve) => server.listen(port, resolve))
  return server
}

const controlUrl = (proxyUrl: string, kind: 'faults' | 'requests', user: string) =>
  `${proxyUrl}/__${kind}/${encodeURIComponent(user)}`

// Makes every request of this user fail, or answer slowly, until cleared.
export const injectFault = (proxyUrl: string, user: string, fault: Fault) =>
  fetch(controlUrl(proxyUrl, 'faults', user), { method: 'PUT', body: JSON.stringify(fault) })

export const clearFault = (proxyUrl: string, user: string) =>
  fetch(controlUrl(proxyUrl, 'faults', user), { method: 'DELETE' })

export const receivedRequests = async (proxyUrl: string, user: string) =>
  (await (await fetch(controlUrl(proxyUrl, 'requests', user))).json()) as string[]

export const clearReceivedRequests = (proxyUrl: string, user: string) =>
  fetch(controlUrl(proxyUrl, 'requests', user), { method: 'DELETE' })
