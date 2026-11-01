import { apiUrl } from './http'

// The request headers the API's MCP endpoint reads. Cookies and the rest stay behind.
const FORWARDED_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'mcp-protocol-version',
]

// The response headers an MCP client reads.
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'www-authenticate']

const pick = (headers: Headers, names: readonly string[]) => {
  const picked = new Headers()
  for (const name of names) {
    const value = headers.get(name)
    if (value !== null) picked.set(name, value)
  }
  return picked
}

// Sends an MCP client's JSON-RPC request to the API untouched, with its own credentials, and
// answers with the API's response as it is. The web app's session plays no part: MCP clients
// authenticate with an API key or a token exchanged from one.
export const forwardToMcp = async (request: Request): Promise<Response> => {
  let upstream: Response
  try {
    upstream = await fetch(`${apiUrl}/v1/mcp`, {
      method: 'POST',
      headers: pick(request.headers, FORWARDED_REQUEST_HEADERS),
      body: await request.text(),
      cache: 'no-store',
    })
  } catch {
    return new Response(null, { status: 502 })
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: pick(upstream.headers, FORWARDED_RESPONSE_HEADERS),
  })
}
