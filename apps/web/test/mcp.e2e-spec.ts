import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'
import type { Database } from '../../api/src/db/database'
import { seedApiKey } from '../../api/src/db/seed'
import { API_KEY_SECRET, SEEDED } from './fixtures'
import { connectDatabase, createUser } from './session'

const { apiUrl: API_URL, webUrl: WEB_URL } = SEEDED

// Where AI assistants reach the MCP server through the web app's public hostname.
const WEB_MCP_URL = `${WEB_URL}/api/mcp`

// The API's own MCP endpoint, which the web route must answer exactly like.
const API_MCP_URL = `${API_URL}/v1/mcp`

// Sends one JSON-RPC request the way an MCP client does, with the bearer unless it is null.
const rpc = (url: string, method: string, bearer: string | null) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-06-18',
  }
  if (bearer !== null) headers['Authorization'] = `Bearer ${bearer}`
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} }),
  })
}

const answerOf = async (response: Response) => ({
  status: response.status,
  body: await response.text(),
})

describe('MCP through the web app (e2e)', () => {
  let database: Database
  let key: string

  beforeAll(async () => {
    database = await connectDatabase()
    const username = await createUser(database)
    const created = await seedApiKey(
      database,
      { username, name: 'Muse', expiresIn: '90d' },
      API_KEY_SECRET,
    )
    key = created.key
  })

  afterAll(() => {
    database.close()
  })

  it('answers an MCP request with an API key exactly like the API does', async () => {
    const throughWeb = await answerOf(await rpc(WEB_MCP_URL, 'tools/list', key))
    const direct = await answerOf(await rpc(API_MCP_URL, 'tools/list', key))

    expect(throughWeb.status).toBe(200)
    expect(throughWeb).toEqual(direct)
  })

  it.each([
    ['without an Authorization header', null],
    ['with an unknown API key', `oct_live_${'x'.repeat(32)}`],
  ])('passes the API’s rejection on %s', async (_case, bearer) => {
    const throughWeb = await answerOf(await rpc(WEB_MCP_URL, 'tools/list', bearer))
    const direct = await answerOf(await rpc(API_MCP_URL, 'tools/list', bearer))

    expect(throughWeb.status).toBe(401)
    expect(throughWeb).toEqual(direct)
  })
})
