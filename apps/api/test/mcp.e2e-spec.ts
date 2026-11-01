import {
  API_SCOPES,
  type ApiKey,
  type ApiKeyExpiresIn,
  type DailyLog,
  DEFAULT_DAILY_GOALS,
  ENTRY_NOT_FOUND_MESSAGE,
  GENERIC_ERROR_MESSAGE,
  INSUFFICIENT_SCOPE_MESSAGE,
  INVALID_API_KEY_MESSAGE,
  INVALID_BARCODE_MESSAGE,
  MAX_FOOD_NAME_LENGTH,
  MAX_PER_SERVING,
  MAX_WATER_AMOUNT,
  PRODUCT_NOT_FOUND_MESSAGE,
  type ServingSize,
  foodEntrySchema,
  servingSizeSchema,
  waterEntrySchema,
} from '@open-calorie-tracker/shared'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ZodType } from 'zod'
import { dayQuerySchema } from '../src/daily-log/day.js'
import { Database } from '../src/db/database.js'
import { seedApiKey, seedUser, seedWaterEntry } from '../src/db/seed.js'
import {
  INVALID_TOKENS,
  TEST_ENV,
  type TestApp,
  accessTokenFor,
  createTestApp,
  seedEntries,
  signAccessToken,
  userIdOf,
  withBearer,
} from './app.js'
import {
  type FakeFetch,
  NUTELLA_BARCODE,
  NUTELLA_PRODUCT,
  fakeOpenFoodFacts,
} from './open-food-facts.js'

const USERNAME = 'diego'
const OTHER_USERNAME = 'ana'
const PASSWORD = 'correct-horse-battery-staple'

const NOW = new Date('2026-10-26T14:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000
const at = (msFromNow: number) => new Date(NOW.getTime() + msFromNow)

const DATE = '2026-10-26'
const TIME_ZONE = 'America/New_York'

const PROTOCOL_VERSION = '2025-06-18'

// Every tool, in the order tools/list answers them.
const TOOLS = [
  'get_daily_log',
  'log_food',
  'get_food_entry',
  'update_food_entry',
  'delete_food_entry',
  'log_water',
  'get_water_entry',
  'update_water_entry',
  'delete_water_entry',
  'list_serving_sizes',
  'create_serving_size',
  'get_product',
]

type Tool = { name: string; description?: string; inputSchema: { type: string } }
type ToolResult = {
  content: { type: string; text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}
type RpcResponse<T> = { jsonrpc: '2.0'; id: number; result?: T; error?: unknown }

// The messages a shared schema gives for an invalid value.
const messagesOf = (schema: ZodType, value: unknown) => {
  const parsed = schema.safeParse(value)
  if (parsed.success) throw new Error(`${JSON.stringify(value)} is valid`)
  return parsed.error.issues.map((issue) => issue.message)
}

describe('MCP (e2e)', () => {
  let app: TestApp
  let database: Database
  // diego's login token, for what the assistant does not do.
  let loginToken: string
  // diego's "Zapier" key, which never expires.
  let zapier: ApiKey

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    app = await createTestApp()
    database = app.get(Database)
    await seedUser(database, { username: USERNAME, password: PASSWORD })
    await seedUser(database, { username: OTHER_USERNAME, password: PASSWORD })
    loginToken = await accessTokenFor(app, USERNAME, PASSWORD)
    zapier = await seedKey({ name: 'Zapier', expiresIn: 'never' })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await app.close()
  })

  const http = () => request(app.getHttpServer())

  const seedKey = (key: { name: string; expiresIn: ApiKeyExpiresIn; createdAt?: Date }) =>
    seedApiKey(database, { username: USERNAME, ...key }, TEST_ENV.API_KEY_SECRET)

  // Sends one JSON-RPC request to /v1/mcp with diego's key unless told otherwise, or null for no
  // Authorization header.
  const rpc = (method: string, params: object = {}, bearer: string | null = zapier.key) =>
    withBearer(
      http()
        .post('/v1/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('MCP-Protocol-Version', PROTOCOL_VERSION)
        .send({ jsonrpc: '2.0', id: 1, method, params }),
      bearer,
    )

  const initialize = (bearer: string | null = zapier.key) =>
    rpc(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'e2e', version: '1.0.0' },
      },
      bearer,
    )

  const resultOf = <T>(response: request.Response) => {
    expect(response.status).toBe(200)
    const body = response.body as RpcResponse<T>
    expect(body.error).toBeUndefined()
    if (body.result === undefined) throw new Error(`No result in ${JSON.stringify(body)}`)
    return body.result
  }

  const toolNames = async (bearer: string = zapier.key) =>
    resultOf<{ tools: Tool[] }>(await rpc('tools/list', {}, bearer)).tools.map((tool) => tool.name)

  const call = async (name: string, args: object, bearer: string = zapier.key) =>
    resultOf<ToolResult>(await rpc('tools/call', { name, arguments: args }, bearer))

  // The structured result of a tool that succeeded, which its text content repeats as JSON.
  const succeeded = async (name: string, args: object, bearer?: string) => {
    const result = await call(name, args, bearer)
    expect(result.isError ?? false).toBe(false)
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(result.structuredContent) },
    ])
    return result.structuredContent as Record<string, unknown>
  }

  // The text of a tool that failed.
  const failed = async (name: string, args: object, bearer?: string) => {
    const result = await call(name, args, bearer)
    expect(result.isError).toBe(true)
    const [content] = result.content
    if (content === undefined) throw new Error('The error has no content')
    return content.text
  }

  const restBody = async (pending: request.Test, bearer = loginToken) => {
    const response = await withBearer(pending, bearer)
    expect(response.status).toBe(200)
    return response.body as unknown
  }

  const dailyLog = async (date = DATE, bearer = loginToken) =>
    (await restBody(
      http().get('/v1/daily-log').query({ date, timeZone: TIME_ZONE }),
      bearer,
    )) as DailyLog

  const servingSizes = async (bearer = loginToken) =>
    (await restBody(http().get('/v1/serving-sizes'), bearer)) as ServingSize[]

  const keys = async () => (await restBody(http().get('/v1/settings/api-keys'))) as ApiKey[]

  const exchange = async () => {
    const response = await http().post('/v1/token').send({ apiKey: zapier.key })
    expect(response.status).toBe(200)
    return (response.body as { accessToken: string }).accessToken
  }

  const scopedToken = async (scope: string) =>
    signAccessToken({ subject: String(await userIdOf(database, USERNAME)), scope })

  // Valid log_food arguments.
  const OATMEAL = { name: 'Oatmeal', servingSize: '1 cup', quantity: 2, calories: 150, protein: 5 }

  describe('A — connecting', () => {
    it("A1 — diego's API key opens an MCP session", async () => {
      const response = await initialize()

      expect(response.headers['content-type']).toMatch(/^application\/json/)
      const result = resultOf<{
        serverInfo: { name: string }
        capabilities: Record<string, unknown>
      }>(response)
      expect(result.serverInfo.name).toBe('open-calorie-tracker')
      expect(result.capabilities).toHaveProperty('tools')
      expect(result.capabilities).not.toHaveProperty('resources')
      expect(result.capabilities).not.toHaveProperty('prompts')
    })

    it('A2 — a token exchanged from the key works too', async () => {
      const token = await exchange()

      expect((await rpc('tools/list', {}, token)).status).toBe(200)
    })

    it('A3 — every request made with a key records its use', async () => {
      vi.setSystemTime(at(5 * 60_000))

      expect((await rpc('tools/list')).status).toBe(200)

      const [key] = await keys()
      expect(key?.lastUsedAt).toBe('2026-10-26T14:05:00.000Z')
    })

    it('A4 — a request with an exchanged token does not touch the key', async () => {
      const token = await exchange()
      vi.setSystemTime(at(5 * 60_000))

      expect((await rpc('tools/list', {}, token)).status).toBe(200)

      const [key] = await keys()
      expect(key?.lastUsedAt).toBe('2026-10-26T14:00:00.000Z')
    })

    it.each<[string, () => Promise<string>]>([
      ['an unknown key', () => Promise.resolve(`oct_live_${'A'.repeat(32)}`)],
      [
        'an expired key',
        async () =>
          (await seedKey({ name: 'Expired', expiresIn: '30d', createdAt: at(-30 * DAY_MS - 1) }))
            .key,
      ],
      [
        'a revoked key',
        async () => {
          const response = await withBearer(
            http().delete(`/v1/settings/api-keys/${zapier.id}`),
            loginToken,
          )
          expect(response.status).toBe(204)
          return zapier.key
        },
      ],
    ])('A5 — %s gets 401 before any JSON-RPC', async (_case, badKey) => {
      const response = await initialize(await badKey())

      expect(response.status).toBe(401)
      expect((response.body as { message: unknown }).message).toBe(INVALID_API_KEY_MESSAGE)
    })

    it.each<[string, () => Promise<request.Response>]>([
      ['no Authorization header', async () => initialize(null)],
      [
        'a Basic Authorization header',
        async () => initialize(null).set('Authorization', 'Basic abc'),
      ],
      ...INVALID_TOKENS.map(
        ([name, token]) =>
          [name, async () => initialize(await token())] as [
            string,
            () => Promise<request.Response>,
          ],
      ),
      ["diego's login token", async () => initialize(loginToken)],
    ])('A6 — %s gets 401 "Unauthorized"', async (_case, send) => {
      const response = await send()

      expect(response.status).toBe(401)
      expect((response.body as { message: unknown }).message).toBe('Unauthorized')
    })

    it.each([
      ['GET', () => http().get('/v1/mcp')],
      ['DELETE', () => http().delete('/v1/mcp')],
    ])('A7 — %s /v1/mcp gets 405', async (_method, pending) => {
      const response = await withBearer(
        pending().set('Accept', 'application/json, text/event-stream'),
        zapier.key,
      )

      expect(response.status).toBe(405)
    })
  })

  describe('B — discovering tools', () => {
    it('B1 — a key sees every tool', async () => {
      const { tools } = resultOf<{ tools: Tool[] }>(await rpc('tools/list'))

      expect(tools.map((tool) => tool.name)).toEqual(TOOLS)
      for (const tool of tools) {
        expect(tool.description, tool.name).toEqual(expect.stringMatching(/\S/))
        expect(tool.inputSchema.type, tool.name).toBe('object')
      }
    })

    it.each([
      ['daily-log:read', ['get_daily_log']],
      ['food-entries:read', ['get_food_entry']],
      ['food-entries:write', ['delete_food_entry']],
      [
        'food-entries:write serving-sizes:write',
        ['log_food', 'update_food_entry', 'delete_food_entry', 'create_serving_size'],
      ],
      [
        'water-entries:read water-entries:write',
        ['log_water', 'get_water_entry', 'update_water_entry', 'delete_water_entry'],
      ],
      ['serving-sizes:read', ['list_serving_sizes']],
    ])('B2 — a token with %s sees only %j', async (scope, tools) => {
      expect(await toolNames(await scopedToken(scope))).toEqual(tools)
    })

    it("B3 — calling a tool outside the token's scopes", async () => {
      const token = await scopedToken('daily-log:read')

      expect(await failed('log_water', { amount: 8 }, token)).toBe(INSUFFICIENT_SCOPE_MESSAGE)

      expect((await dailyLog()).entries).toEqual([])
    })
  })

  describe('C — daily log', () => {
    it('C1 — reading a day returns what GET /v1/daily-log returns', async () => {
      await seedEntries(database, USERNAME)

      const log = await succeeded('get_daily_log', { date: DATE, timeZone: TIME_ZONE })

      expect(log).toEqual(await dailyLog())
      expect(log).toHaveProperty('goals')
      expect(log).toHaveProperty('totals')
    })

    it('C2 — the day follows the given time zone', async () => {
      await seedWaterEntry(database, {
        username: USERNAME,
        loggedAt: new Date('2026-10-27T03:30:00Z'),
        amount: 8,
      })

      const log = (await succeeded('get_daily_log', {
        date: DATE,
        timeZone: TIME_ZONE,
      })) as DailyLog

      expect(log.totals.water).toBe(8)
    })

    it('C3 — an empty day', async () => {
      const log = (await succeeded('get_daily_log', {
        date: '2026-10-25',
        timeZone: TIME_ZONE,
      })) as DailyLog

      expect(log.entries).toEqual([])
      expect(log.totals.calories).toBe(0)
      expect(log.goals).toEqual(DEFAULT_DAILY_GOALS)
    })

    it("C4 — ana's entries never show in diego's log", async () => {
      await seedEntries(database, OTHER_USERNAME)

      const log = (await succeeded('get_daily_log', {
        date: DATE,
        timeZone: TIME_ZONE,
      })) as DailyLog

      expect(log.entries).toEqual([])
    })

    it.each([
      ['a date that is not YYYY-MM-DD', { date: '26/10/2026', timeZone: TIME_ZONE }],
      ['a date that does not exist', { date: '2026-02-30', timeZone: TIME_ZONE }],
      ['an unknown time zone', { date: DATE, timeZone: 'Mars/Olympus' }],
    ])('C5 — %s is a tool error with the REST message', async (_case, input) => {
      const text = await failed('get_daily_log', input)

      for (const message of messagesOf(dayQuerySchema, input)) expect(text).toContain(message)
    })
  })

  describe('D — food entries', () => {
    it('D1 — logging food with a serving size name, per serving', async () => {
      const entry = await succeeded('log_food', OATMEAL)

      expect(entry).toMatchObject({
        type: 'food',
        name: 'Oatmeal',
        servingSize: '1 cup',
        quantity: 2,
        calories: 300,
        protein: 10,
        loggedAt: NOW.toISOString(),
      })
      expect((await dailyLog()).entries).toEqual([entry])
      expect((await servingSizes()).map((size) => size.name)).toEqual(['1 cup'])
    })

    it('D2 — an existing serving size is reused after normalizing', async () => {
      const response = await withBearer(
        http().post('/v1/serving-sizes').send({ name: '1 cup' }),
        loginToken,
      )
      expect(response.status).toBe(201)
      const cup = response.body as ServingSize

      const entry = await succeeded('log_food', { ...OATMEAL, servingSize: '  1   cup ' })

      expect(entry['servingSize']).toBe('1 cup')
      expect(await servingSizes()).toEqual([cup])
    })

    it('D3 — logging on another day', async () => {
      const entry = await succeeded('log_food', {
        ...OATMEAL,
        loggedAt: '2026-10-25T12:00:00-04:00',
      })

      expect(entry['loggedAt']).toBe('2026-10-25T16:00:00.000Z')
    })

    it('D4 — reading one entry, per serving', async () => {
      const { id } = await succeeded('log_food', OATMEAL)

      const entry = await succeeded('get_food_entry', { id })

      expect(entry).toEqual(await restBody(http().get(`/v1/food-entries/${String(id)}`)))
      expect(entry['calories']).toBe(150)
    })

    it('D5 — updating an entry replaces its fields and keeps its time', async () => {
      const { foodId } = await seedEntries(database, USERNAME)

      const entry = await succeeded('update_food_entry', {
        id: foodId,
        name: 'Porridge',
        servingSize: '1 bowl',
        quantity: 1,
        calories: 200,
      })

      expect(entry).toMatchObject({
        id: foodId,
        name: 'Porridge',
        servingSize: '1 bowl',
        calories: 200,
        loggedAt: '2026-10-26T13:00:00.000Z',
      })
    })

    it('D6 — deleting an entry', async () => {
      const { foodId } = await seedEntries(database, USERNAME)

      expect(await succeeded('delete_food_entry', { id: foodId })).toEqual({
        id: foodId,
        deleted: true,
      })

      const names = (await dailyLog()).entries.map((entry) => entry.type)
      expect(names).toEqual(['water'])
    })

    it.each<[string, object, ZodType, unknown]>([
      ['a blank name', { name: '   ' }, foodEntrySchema.shape.name, '   '],
      [
        'a name over the maximum',
        { name: 'a'.repeat(MAX_FOOD_NAME_LENGTH + 1) },
        foodEntrySchema.shape.name,
        'a'.repeat(MAX_FOOD_NAME_LENGTH + 1),
      ],
      ['a blank serving size', { servingSize: '  ' }, servingSizeSchema.shape.name, '  '],
      [
        'calories over the maximum',
        { calories: MAX_PER_SERVING + 1 },
        foodEntrySchema.shape.calories,
        MAX_PER_SERVING + 1,
      ],
      ['calories with two decimals', { calories: 1.25 }, foodEntrySchema.shape.calories, 1.25],
      ['servings off the 0.5 step', { quantity: 0.75 }, foodEntrySchema.shape.quantity, 0.75],
    ])('D7 — %s is a tool error with the shared message', async (_case, change, schema, value) => {
      const text = await failed('log_food', { ...OATMEAL, ...change })

      for (const message of messagesOf(schema, value)) expect(text).toContain(message)
      expect((await dailyLog()).entries).toEqual([])
    })
  })

  describe('E — water entries', () => {
    it('E1 — logging water in US fl oz', async () => {
      const entry = await succeeded('log_water', { amount: 8 })

      expect(entry).toMatchObject({ type: 'water', amount: 8, loggedAt: NOW.toISOString() })
      expect((await dailyLog()).entries).toEqual([entry])
    })

    it('E2 — logging water on another day', async () => {
      const entry = await succeeded('log_water', {
        amount: 8,
        loggedAt: '2026-10-25T12:00:00-04:00',
      })

      expect(entry['loggedAt']).toBe('2026-10-25T16:00:00.000Z')
    })

    it('E3 — reading, updating and deleting water', async () => {
      const { waterId } = await seedEntries(database, USERNAME)

      expect(await succeeded('get_water_entry', { id: waterId })).toEqual(
        await restBody(http().get(`/v1/water-entries/${waterId}`)),
      )

      expect(await succeeded('update_water_entry', { id: waterId, amount: 12 })).toMatchObject({
        id: waterId,
        amount: 12,
        loggedAt: '2026-10-26T13:00:00.000Z',
      })

      expect(await succeeded('delete_water_entry', { id: waterId })).toEqual({
        id: waterId,
        deleted: true,
      })
      expect((await dailyLog()).entries.map((entry) => entry.type)).toEqual(['food'])
    })

    it.each([
      ['no amount', 0],
      ['an amount over the maximum', MAX_WATER_AMOUNT + 1],
      ['an amount with two decimals', 8.25],
    ])('E4 — %s is a tool error with the shared message', async (_case, amount) => {
      const text = await failed('log_water', { amount })

      for (const message of messagesOf(waterEntrySchema.shape.amount, amount)) {
        expect(text).toContain(message)
      }
      expect((await dailyLog()).entries).toEqual([])
    })
  })

  describe('F — serving sizes', () => {
    it('F1 — listing serving sizes', async () => {
      const anaToken = await accessTokenFor(app, OTHER_USERNAME, PASSWORD)
      for (const [name, bearer] of [
        ['1 cup', loginToken],
        ['1 slice', loginToken],
        ['1 bowl', anaToken],
      ] as const) {
        const response = await withBearer(http().post('/v1/serving-sizes').send({ name }), bearer)
        expect(response.status).toBe(201)
      }

      const result = await succeeded('list_serving_sizes', {})

      expect(result).toEqual({ servingSizes: await servingSizes() })
      expect((result['servingSizes'] as ServingSize[]).map((size) => size.name)).not.toContain(
        '1 bowl',
      )
    })

    it('F2 — creating a serving size, or getting the existing one', async () => {
      const created = await succeeded('create_serving_size', { name: ' 1   cup ' })
      expect(created).toEqual({ id: expect.any(Number) as unknown, name: '1 cup' })

      expect(await succeeded('create_serving_size', { name: '1 cup' })).toEqual(created)

      expect(await servingSizes()).toEqual([created])
    })
  })

  describe('G — ownership and missing entries', () => {
    const MISSING_ID = 999_999

    type Ids = Awaited<ReturnType<typeof seedEntries>>

    it.each<[string, string, (ids: Ids) => object]>([
      ["ana's", 'get_food_entry', ({ foodId }) => ({ id: foodId })],
      [
        "ana's",
        'update_food_entry',
        ({ foodId }) => ({
          id: foodId,
          name: 'Apple',
          servingSize: '1 cup',
          quantity: 1,
          calories: 95,
        }),
      ],
      ["ana's", 'delete_food_entry', ({ foodId }) => ({ id: foodId })],
      ["ana's", 'get_water_entry', ({ waterId }) => ({ id: waterId })],
      ["ana's", 'update_water_entry', ({ waterId }) => ({ id: waterId, amount: 8 })],
      ["ana's", 'delete_water_entry', ({ waterId }) => ({ id: waterId })],
      ['a missing', 'get_food_entry', () => ({ id: MISSING_ID })],
      ['a missing', 'get_water_entry', () => ({ id: MISSING_ID })],
    ])('G1 — %s entry in %s answers like a missing one', async (_whose, tool, args) => {
      const ids = await seedEntries(database, OTHER_USERNAME)
      const anaToken = await accessTokenFor(app, OTHER_USERNAME, PASSWORD)
      const before = await dailyLog(DATE, anaToken)

      expect(await failed(tool, args(ids))).toBe(ENTRY_NOT_FOUND_MESSAGE)

      expect(await dailyLog(DATE, anaToken)).toEqual(before)
    })
  })

  describe('get_product', () => {
    let fetch: FakeFetch

    beforeEach(() => {
      fetch = fakeOpenFoodFacts()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('F1 — get_product is listed last, for tokens with "products:read"', async () => {
      const { tools } = resultOf<{ tools: Tool[] }>(await rpc('tools/list'))

      const tool = tools.at(-1) as Tool & {
        inputSchema: { properties?: Record<string, { type?: string }>; required?: string[] }
      }
      expect(tool.name).toBe('get_product')
      expect(tool.inputSchema.properties?.['barcode']?.type).toBe('string')
      expect(tool.inputSchema.required).toEqual(['barcode'])
      expect(tool.description).toContain('log_food')
      expect(tool.description).toContain('null')
      expect(await toolNames(await scopedToken('products:read'))).toEqual(['get_product'])
    })

    it('F2 — get_product answers the same model as the API', async () => {
      expect(await succeeded('get_product', { barcode: NUTELLA_BARCODE })).toEqual(NUTELLA_PRODUCT)
    })

    it.each<[string, () => void, string, () => string]>([
      ['an invalid barcode', () => undefined, '1234567', () => INVALID_BARCODE_MESSAGE],
      [
        'a product Open Food Facts does not have',
        () => undefined,
        '12345670',
        () => PRODUCT_NOT_FOUND_MESSAGE,
      ],
      [
        'Open Food Facts answering 500',
        () => fetch.mockResolvedValue(new Response('', { status: 500 })),
        NUTELLA_BARCODE,
        () => GENERIC_ERROR_MESSAGE,
      ],
    ])('F3 — %s comes back as a tool error', async (_case, arrange, barcode, message) => {
      arrange()

      expect(await failed('get_product', { barcode })).toBe(message())
    })

    it.each([{}, { barcode: null }, { barcode: Number(NUTELLA_BARCODE) }])(
      'F3 — get_product with %j comes back as an invalid barcode',
      async (args) => {
        expect(await failed('get_product', args)).toBe(INVALID_BARCODE_MESSAGE)
        expect(fetch).not.toHaveBeenCalled()
      },
    )

    it('F4 — a token without "products:read" neither lists nor runs get_product', async () => {
      const token = await scopedToken(
        API_SCOPES.filter((scope) => scope !== 'products:read').join(' '),
      )

      expect(await toolNames(token)).not.toContain('get_product')
      expect(await failed('get_product', { barcode: NUTELLA_BARCODE }, token)).toBe(
        INSUFFICIENT_SCOPE_MESSAGE,
      )
      expect(fetch).not.toHaveBeenCalled()
    })
  })
})
