import { type Server, createServer, request } from 'node:http'

export type Fault = { status: number } | 'connection-reset'

// Sits between Next.js and the real API. It forwards everything untouched unless a test asks it
// to fail through the control endpoint, so tests can exercise backend failures without mocks.
export const startFaultProxy = async (port: number, targetUrl: string): Promise<Server> => {
  const target = new URL(targetUrl)
  let fault: Fault | undefined

  const server = createServer((req, res) => {
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

    if (fault === 'connection-reset') {
      req.socket.destroy()
      return
    }
    if (fault !== undefined) {
      res.writeHead(fault.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: 'Injected failure' }))
      return
    }

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
  })

  await new Promise<void>((resolve) => server.listen(port, resolve))
  return server
}

export const injectFault = (proxyUrl: string, fault: Fault) =>
  fetch(`${proxyUrl}/__fault`, { method: 'PUT', body: JSON.stringify(fault) })

export const clearFault = (proxyUrl: string) => fetch(`${proxyUrl}/__fault`, { method: 'DELETE' })
