import { type Server, createServer, request } from 'node:http'

export type Fault = { status: number } | { delayMs: number } | 'connection-reset'

// Sits between Next.js and the real API. It forwards everything untouched unless a test asks it
// to fail or to answer slowly through the control endpoint, so tests can exercise backend
// failures without mocks. It also records the requests it receives, e.g. "GET /v1/daily-log?...".
export const startFaultProxy = async (port: number, targetUrl: string): Promise<Server> => {
  const target = new URL(targetUrl)
  let fault: Fault | undefined
  let requests: string[] = []

  const server = createServer((req, res) => {
    if (req.url === '/__requests') {
      if (req.method === 'DELETE') requests = []
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(requests))
      return
    }

    if (req.url === '/__fault') {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString()
        fault = req.method === 'PUT' ? (JSON.parse(body) as Fault) : undefined
        res.writeHead(204).end()
      })
      return
    }

    requests.push(`${req.method} ${req.url}`)

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
          res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
          upstreamRes.pipe(res)
        },
      )
      upstream.on('error', () => res.writeHead(502).end())
      req.pipe(upstream)
    }

    if (fault !== undefined && 'delayMs' in fault) setTimeout(forward, fault.delayMs)
    else forward()
  })

  await new Promise<void>((resolve) => server.listen(port, resolve))
  return server
}

export const injectFault = (proxyUrl: string, fault: Fault) =>
  fetch(`${proxyUrl}/__fault`, { method: 'PUT', body: JSON.stringify(fault) })

export const clearFault = (proxyUrl: string) => fetch(`${proxyUrl}/__fault`, { method: 'DELETE' })

export const receivedRequests = async (proxyUrl: string) =>
  (await (await fetch(`${proxyUrl}/__requests`)).json()) as string[]

export const clearReceivedRequests = (proxyUrl: string) =>
  fetch(`${proxyUrl}/__requests`, { method: 'DELETE' })
